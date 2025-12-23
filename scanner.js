import { ethers } from 'ethers';
import { config } from './config.js';
import { loadData, saveData, addTransfer } from './storage.js';

// Interface ERC20 Transfer event
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

/**
 * Scanner principal pour les transfers ERC20
 */
async function scanBlocks() {
  console.log('🚀 Démarrage du scan Ethereum...');
  console.log(`Token: ${config.tokenAddress}`);
  console.log(`Block de départ: ${config.startBlock}`);
  
  // Connexion au provider Ethereum
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  
  // Vérifier la connexion
  try {
    const network = await provider.getNetwork();
    console.log(`✅ Connecté au réseau: ${network.name} (chainId: ${network.chainId})`);
  } catch (error) {
    console.error('❌ Erreur de connexion au provider:', error);
    process.exit(1);
  }
  
  // Charger les données existantes
  let data = loadData(config.dataFile);
  console.log(`📊 ${Object.keys(data.addresses || {}).length} adresses déjà enregistrées`);
  
  // Créer un Set pour stocker les txHash déjà traités (déduplication)
  const processedTxHashes = new Set();
  
  // Parcourir les transfers existants pour :
  // 1. Trouver le dernier blockNumber
  // 2. Collecter les txHash déjà traités
  let lastProcessedBlock = config.startBlock - 1;
  
  if (data.addresses && Object.keys(data.addresses).length > 0) {
    console.log('📂 Fichier existant trouvé, analyse des transfers...');
    
    Object.values(data.addresses).forEach(addr => {
      if (addr.transfers && Array.isArray(addr.transfers)) {
        addr.transfers.forEach(transfer => {
          // Collecter les txHash pour la déduplication
          if (transfer.txHash) {
            processedTxHashes.add(transfer.txHash.toLowerCase());
          }
          
          // Trouver le dernier blockNumber traité
          if (transfer.blockNumber && transfer.blockNumber > lastProcessedBlock) {
            lastProcessedBlock = transfer.blockNumber;
          }
        });
      }
    });
    
    console.log(`📊 ${processedTxHashes.size} transfers déjà traités`);
    console.log(`📦 Dernier block traité: ${lastProcessedBlock}`);
    console.log(`🔄 Reprise du scan à partir du block ${lastProcessedBlock + 1}`);
  } else {
    console.log('📝 Nouveau fichier, démarrage depuis le block de départ');
  }
  
  // Obtenir le dernier block
  const latestBlock = await provider.getBlockNumber();
  console.log(`📦 Block actuel sur la blockchain: ${latestBlock}`);
  
  // Créer le contrat pour filtrer les événements
  const tokenContract = new ethers.Contract(config.tokenAddress, ERC20_ABI, provider);
  
  // Scanner les blocks par batch
  // Commencer au block suivant le dernier traité
  let currentBlock = lastProcessedBlock + 1;
  let totalTransfers = 0;
  let newTransfers = 0;
  let duplicateTransfers = 0;
  
  while (currentBlock <= latestBlock) {
    const endBlock = Math.min(currentBlock + config.batchSize - 1, latestBlock);
    
    try {
      console.log(`\n🔍 Scan des blocks ${currentBlock} à ${endBlock}...`);
      
      // Filtrer les événements Transfer pour cette plage de blocks
      const filter = tokenContract.filters.Transfer();
      const events = await tokenContract.queryFilter(filter, currentBlock, endBlock);
      
      console.log(`   📝 ${events.length} transfer(s) trouvé(s)`);
      
      // Traiter chaque événement
      for (const event of events) {
        const from = event.args.from;
        const to = event.args.to;
        const amount = event.args.value.toString();
        const blockNumber = event.blockNumber;
        const txHash = event.transactionHash.toLowerCase(); // Normaliser en minuscules
        
        // Vérifier si ce transfer a déjà été traité
        if (processedTxHashes.has(txHash)) {
          duplicateTransfers++;
          continue; // Ignorer les doublons
        }
        
        // Ajouter le transfer aux données
        data = addTransfer(data, from, to, amount, blockNumber, txHash);
        
        // Marquer ce txHash comme traité
        processedTxHashes.add(txHash);
        
        totalTransfers++;
        newTransfers++;
      }
      
      // Sauvegarder périodiquement (tous les 100 blocks ou à la fin)
      if (events.length > 0 || endBlock === latestBlock) {
        saveData(data, config.dataFile);
        console.log(`   💾 Données sauvegardées`);
      }
      
      currentBlock = endBlock + 1;
      
      // Petite pause pour éviter de surcharger le RPC
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Erreur lors du scan des blocks ${currentBlock}-${endBlock}:`, error.message);
      // Continuer avec le batch suivant
      currentBlock = endBlock + 1;
    }
  }
  
  console.log(`\n✅ Scan terminé!`);
  console.log(`📊 Total de transfers dans le fichier: ${totalTransfers}`);
  console.log(`🆕 Nouveaux transfers ajoutés: ${newTransfers}`);
  console.log(`🔄 Transfers dupliqués ignorés: ${duplicateTransfers}`);
  console.log(`👥 Total d'adresses uniques: ${Object.keys(data.addresses).length}`);
  console.log(`💾 Données sauvegardées dans: ${config.dataFile}`);
  
  return { totalTransfers, newTransfers, duplicateTransfers };
}

// Fonction pour scanner en continu
async function scanContinuous() {
  console.log('🔄 Mode continu activé - scan toutes les 60 secondes');
  console.log('Appuyez sur Ctrl+C pour arrêter\n');
  
  while (true) {
    try {
      const startTime = Date.now();
      await scanBlocks();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`⏱️  Scan effectué en ${duration}s`);
      
      // Attendre 60 secondes avant le prochain scan
      console.log('⏳ Attente de 60 secondes avant le prochain scan...\n');
      await new Promise(resolve => setTimeout(resolve, 60000));
    } catch (error) {
      console.error('❌ Erreur lors du scan continu:', error);
      console.log('⏳ Nouvelle tentative dans 60 secondes...\n');
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

// Vérifier les arguments de ligne de commande
const args = process.argv.slice(2);
const isContinuous = args.includes('--continuous') || args.includes('-c');

// Exécuter le scan
if (isContinuous) {
  scanContinuous().catch(error => {
    console.error('❌ Erreur fatale:', error);
    process.exit(1);
  });
} else {
  scanBlocks().catch(error => {
    console.error('❌ Erreur fatale:', error);
    process.exit(1);
  });
}

