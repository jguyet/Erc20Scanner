import { loadData } from './storage.js';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adresses des exchanges
const MEXC_ADDRESS = '0x9642b23Ed1E01Df1092B92641051881a322F5D4E'.toLowerCase();
const KUCOIN_ADDRESSES = [
  '0x3B9F91d968A5fB014eFF74cdb6E6334AE7dbCc16',
  '0x7E20E121DED9ED7c67b4971eeD536E8F82873DF3',
  '0x58edF78281334335EfFa23101bBe3371b6a36A51'
].map(addr => addr.toLowerCase());
const UNISWAP_ADDRESS = '0x2D0Cd4E0065fE645C983C00DB29A9A3d66eb2073'.toLowerCase();

const EXCHANGE_ADDRESSES = new Set([MEXC_ADDRESS, ...KUCOIN_ADDRESSES, UNISWAP_ADDRESS]);

// Charger les labels
function loadLabels() {
  const labelsPath = path.resolve(__dirname, 'labels.json');
  try {
    const content = fs.readFileSync(labelsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Erreur lors de la lecture des labels:', error);
    return {};
  }
}

// Formater un montant (wei vers tokens avec 18 décimales)
function formatAmount(weiAmount) {
  const amount = BigInt(weiAmount);
  const divisor = BigInt(10 ** 18);
  const whole = amount / divisor;
  const remainder = amount % divisor;
  
  if (remainder === 0n) {
    return whole.toString();
  } else {
    const remainderStr = remainder.toString().padStart(18, '0');
    const trimmed = remainderStr.replace(/0+$/, '');
    return trimmed ? `${whole}.${trimmed}` : whole.toString();
  }
}

// Formater en USD
function formatUSD(amountStr) {
  const amountNum = parseFloat(amountStr);
  const usdValue = amountNum * config.tokenPriceUSD;
  return usdValue.toLocaleString('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Vérifie si une adresse est un exchange
 */
function isExchange(address) {
  return EXCHANGE_ADDRESSES.has(address.toLowerCase());
}

/**
 * Retourne le nom de l'exchange
 */
function getExchangeName(address) {
  const addr = address.toLowerCase();
  if (addr === MEXC_ADDRESS) return 'MEXC';
  if (KUCOIN_ADDRESSES.includes(addr)) return 'Kucoin';
  if (addr === UNISWAP_ADDRESS) return 'Uniswap';
  return null;
}

/**
 * Trouve l'adresse originale dans les données (insensible à la casse)
 */
function findAddressInData(data, address) {
  const normalized = address.toLowerCase();
  
  // Essayer directement
  if (data.addresses[address]) {
    return { address: address, info: data.addresses[address] };
  }
  
  // Essayer en minuscules
  if (data.addresses[normalized]) {
    return { address: normalized, info: data.addresses[normalized] };
  }
  
  // Chercher par comparaison insensible à la casse
  for (const [addr, info] of Object.entries(data.addresses || {})) {
    if (addr.toLowerCase() === normalized) {
      return { address: addr, info: info };
    }
  }
  
  return null;
}

/**
 * Remonte depuis une adresse jusqu'à trouver un label
 * en suivant les transfers entrants dans l'ordre chronologique inverse
 * S'arrête si le chemin passe par un wallet Helios
 */
function traceBackToLabel(data, startAddress, labels, allLabels, maxDepth = 50) {
  const visited = new Set();
  const queue = [];
  
  // Trouver l'adresse originale
  const startEntry = findAddressInData(data, startAddress);
  if (!startEntry) {
    return null;
  }
  
  // Vérifier si c'est déjà un label valide (pas Helios)
  const startNormalized = startEntry.address.toLowerCase();
  const labelAtStart = labels.get(startNormalized) || labels.get(startEntry.address);
  if (labelAtStart) {
    return {
      address: startNormalized,
      label: labelAtStart
    };
  }
  
  // Vérifier si c'est un wallet Helios (arrêter immédiatement)
  const heliosLabelAtStart = allLabels.get(startNormalized) || allLabels.get(startEntry.address);
  if (heliosLabelAtStart && heliosLabelAtStart.toLowerCase().includes('helios')) {
    return null; // Arrêter si on commence par un wallet Helios
  }
  
  // Initialiser la queue
  queue.push({
    address: startEntry.address,
    addressNormalized: startNormalized,
    depth: 0
  });
  
  while (queue.length > 0) {
    const current = queue.shift();
    const addressNormalized = current.addressNormalized;
    
    // Éviter les boucles
    if (visited.has(addressNormalized)) {
      continue;
    }
    
    // Limiter la profondeur
    if (current.depth > maxDepth) {
      continue;
    }
    
    visited.add(addressNormalized);
    
    // Trouver les données de l'adresse
    const addressEntry = findAddressInData(data, current.address);
    if (!addressEntry || !addressEntry.info.transfers) {
      continue;
    }
    
    // Trier les transfers entrants par blockNumber décroissant (ordre chronologique inverse)
    // On veut remonter dans le temps, donc on prend les transfers les plus récents d'abord
    const inTransfers = addressEntry.info.transfers
      .filter(t => t.type === 'in' && t.from && 
                   t.from !== '0x0000000000000000000000000000000000000000' &&
                   t.from !== '0x000000000000000000000000000000000000dead')
      .sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return b.blockNumber - a.blockNumber; // Décroissant (plus récent d'abord)
        }
        return (b.txHash || '').localeCompare(a.txHash || '');
      });
    
    for (const transfer of inTransfers) {
      const fromAddress = transfer.from.toLowerCase();
      
      // Vérifier si c'est un wallet Helios (arrêter la recherche)
      const heliosLabel = allLabels.get(fromAddress);
      if (heliosLabel && heliosLabel.toLowerCase().includes('helios')) {
        return null; // Arrêter si le chemin passe par un wallet Helios
      }
      
      // Vérifier si c'est un label valide (pas Helios)
      const label = labels.get(fromAddress);
      if (label) {
        return {
          address: fromAddress,
          label: label
        };
      }
      
      // Sinon, continuer à remonter
      if (!visited.has(fromAddress) && current.depth < maxDepth) {
        queue.push({
          address: transfer.from,
          addressNormalized: fromAddress,
          depth: current.depth + 1
        });
      }
    }
  }
  
  return null;
}

/**
 * Analyse les ventes vers MEXC et Kucoin en suivant les wallets enfants des labels
 */
function analyzeSales() {
  console.log('📊 Analyse des ventes vers MEXC et Kucoin (en suivant les wallets enfants)...\n');
  
  // Charger les données
  const data = loadData(config.dataFile);
  const labels = loadLabels();
  
  // Adresses à exclure (exchanges et Uniswap)
  const UNISWAP_ADDRESS = '0x2D0Cd4E0065fE645C983C00DB29A9A3d66eb2073'.toLowerCase();
  const excludedAddresses = new Set([
    MEXC_ADDRESS,
    ...KUCOIN_ADDRESSES,
    UNISWAP_ADDRESS
  ]);
  
  // Identifier les labels à analyser (exclure les exchanges et Uniswap)
  const labelsToAnalyze = [];
  for (const [address, label] of Object.entries(labels)) {
    const addrLower = address.toLowerCase();
    if (label && typeof label === 'string' && 
        label !== 'Token Contract' && 
        !excludedAddresses.has(addrLower)) {
      labelsToAnalyze.push({
        address: addrLower,
        label: label
      });
    }
  }
  
  console.log(`🏷️  ${labelsToAnalyze.length} labels à analyser (excluant MEXC, Kucoin, Uniswap)\n`);
  
  // D'abord, vérifier s'il y a des transfers vers les exchanges
  let directExchangeTransfers = 0;
  const exchangeTransfersFound = [];
  for (const [address, info] of Object.entries(data.addresses || {})) {
    if (info.transfers) {
      for (const transfer of info.transfers) {
        if (transfer.type === 'out' && transfer.to) {
          const toAddr = transfer.to.toLowerCase();
          if (isExchange(toAddr)) {
            directExchangeTransfers++;
            if (exchangeTransfersFound.length < 5) {
              exchangeTransfersFound.push({
                from: address.toLowerCase(),
                to: toAddr,
                amount: transfer.amount,
                exchange: getExchangeName(toAddr)
              });
            }
          }
        }
      }
    }
  }
  console.log(`🔍 ${directExchangeTransfers} transfers directs vers les exchanges trouvés dans les données`);
  if (exchangeTransfersFound.length > 0) {
    console.log(`   Exemples:`);
    exchangeTransfersFound.forEach(t => {
      console.log(`   - ${t.from.substring(0, 10)}... → ${t.exchange} (${formatAmount(t.amount)} tokens)`);
    });
  }
  console.log('');
  
  // Créer un index de TOUS les labels (pour détecter les wallets Helios et arrêter la recherche)
  const allLabelsIndex = new Map();
  for (const [address, label] of Object.entries(labels)) {
    const addrLower = address.toLowerCase();
    if (label && typeof label === 'string' && label !== 'Token Contract') {
      allLabelsIndex.set(addrLower, label);
    }
  }
  
  // Créer un index des labels à analyser (exclure les exchanges, Uniswap et les labels avec "Helios")
  const labelsIndex = new Map();
  for (const [address, label] of Object.entries(labels)) {
    const addrLower = address.toLowerCase();
    if (label && typeof label === 'string' && 
        label !== 'Token Contract' && 
        !excludedAddresses.has(addrLower) &&
        !label.toLowerCase().includes('helios')) {
      labelsIndex.set(addrLower, label);
    }
  }
  
  console.log(`🏷️  ${labelsIndex.size} labels dans l'index (excluant MEXC, Kucoin, Uniswap, et labels avec "Helios")\n`);
  
  // Map pour stocker les ventes par label
  const salesByLabel = new Map();
  
  // Pour chaque transfer vers un exchange, remonter jusqu'à trouver un label
  console.log('🔍 Remontée depuis les exchanges vers les labels...\n');
  
  let processedTransfers = 0;
  let transfersWithLabel = 0;
  const processedTxHashes = new Set(); // Pour éviter de compter deux fois le même transfer
  
  for (const [address, info] of Object.entries(data.addresses || {})) {
    if (!info.transfers) {
      continue;
    }
    
    for (const transfer of info.transfers) {
      if (transfer.type === 'out' && transfer.to) {
        const toAddress = transfer.to.toLowerCase();
        
        // Vérifier si c'est un transfer vers un exchange
        if (isExchange(toAddress)) {
          const txHash = (transfer.txHash || '').toLowerCase();
          
          // Éviter de compter deux fois le même transfer
          if (txHash && processedTxHashes.has(txHash)) {
            continue;
          }
          
          processedTxHashes.add(txHash);
          processedTransfers++;
          
          if (processedTransfers % 50 === 0 || processedTransfers === directExchangeTransfers) {
            process.stdout.write(`\r   ⏳ ${processedTransfers}/${directExchangeTransfers} transfers traités...`);
          }
          
          // Remonter jusqu'à trouver un label (s'arrête si passe par un wallet Helios)
          const labelSource = traceBackToLabel(data, address, labelsIndex, allLabelsIndex);
          
          if (labelSource) {
            transfersWithLabel++;
            const labelAddress = labelSource.address;
            const amount = BigInt(transfer.amount);
            const exchangeName = getExchangeName(toAddress);
            
            if (!salesByLabel.has(labelAddress)) {
              salesByLabel.set(labelAddress, {
                address: labelAddress,
                label: labelSource.label,
                totalAmount: BigInt(0),
                sales: {
                  MEXC: BigInt(0),
                  Kucoin: BigInt(0),
                  Uniswap: BigInt(0)
                },
                transactionCount: {
                  MEXC: 0,
                  Kucoin: 0,
                  Uniswap: 0
                }
              });
            }
            
            const labelSales = salesByLabel.get(labelAddress);
            labelSales.totalAmount += amount;
            labelSales.sales[exchangeName] += amount;
            labelSales.transactionCount[exchangeName]++;
          } else if (processedTransfers <= 5) {
            // Debug: afficher les premiers transfers sans label trouvé
            console.log(`   ⚠️  Pas de label trouvé pour ${address.substring(0, 10)}... → ${getExchangeName(toAddress)}`);
          }
        }
      }
    }
  }
  
  console.log(`\n   📊 ${transfersWithLabel} transfers reliés à des labels`);
  
  console.log(`\n   ✅ ${salesByLabel.size} labels avec des ventes trouvés\n`);
  
  // Convertir en tableau et trier par montant total décroissant
  const labelSales = Array.from(salesByLabel.values())
    .map(sales => ({
      ...sales,
      totalAmount: sales.totalAmount.toString(),
      sales: {
        MEXC: sales.sales.MEXC.toString(),
        Kucoin: sales.sales.Kucoin.toString(),
        Uniswap: sales.sales.Uniswap.toString()
      }
    }))
    .sort((a, b) => {
      const aTotal = BigInt(a.totalAmount);
      const bTotal = BigInt(b.totalAmount);
      return bTotal > aTotal ? 1 : bTotal < aTotal ? -1 : 0;
    });
  
  // Afficher les résultats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📈 TOP LABELS VENDEURS VERS MEXC ET KUCOIN');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (labelSales.length === 0) {
    console.log('❌ Aucune vente trouvée vers MEXC ou Kucoin depuis les labels.\n');
    return;
  }
  
  // Statistiques globales
  const totalSales = labelSales.reduce((sum, s) => sum + BigInt(s.totalAmount), BigInt(0));
  const totalMEXC = labelSales.reduce((sum, s) => sum + BigInt(s.sales.MEXC), BigInt(0));
  const totalKucoin = labelSales.reduce((sum, s) => sum + BigInt(s.sales.Kucoin), BigInt(0));
  const totalUniswap = labelSales.reduce((sum, s) => sum + BigInt(s.sales.Uniswap), BigInt(0));
  
  console.log(`📊 Statistiques globales:`);
  console.log(`   Total vendu: ${formatAmount(totalSales.toString())} tokens (${formatUSD(formatAmount(totalSales.toString()))})`);
  console.log(`   Vers MEXC: ${formatAmount(totalMEXC.toString())} tokens (${formatUSD(formatAmount(totalMEXC.toString()))})`);
  console.log(`   Vers Kucoin: ${formatAmount(totalKucoin.toString())} tokens (${formatUSD(formatAmount(totalKucoin.toString()))})`);
  console.log(`   Vers Uniswap: ${formatAmount(totalUniswap.toString())} tokens (${formatUSD(formatAmount(totalUniswap.toString()))})`);
  console.log(`   Nombre de labels vendeurs: ${labelSales.length}\n`);
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🏆 CLASSEMENT DES LABELS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  labelSales.forEach((sales, index) => {
    const rank = index + 1;
    const totalFormatted = formatAmount(sales.totalAmount);
    const mexcFormatted = formatAmount(sales.sales.MEXC);
    const kucoinFormatted = formatAmount(sales.sales.Kucoin);
    
    console.log(`${rank}. ${sales.label}`);
    console.log(`   Adresse: ${sales.address}`);
    console.log(`   Total: ${totalFormatted} tokens (${formatUSD(totalFormatted)})`);
    console.log(`   ├─ MEXC: ${mexcFormatted} tokens (${formatUSD(mexcFormatted)}) - ${sales.transactionCount.MEXC} transaction(s)`);
    console.log(`   └─ Kucoin: ${kucoinFormatted} tokens (${formatUSD(kucoinFormatted)}) - ${sales.transactionCount.Kucoin} transaction(s)`);
    console.log('');
  });
  
  // Top 10
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🥇 TOP 10');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  labelSales.slice(0, 10).forEach((sales, index) => {
    const rank = index + 1;
    const totalFormatted = formatAmount(sales.totalAmount);
    console.log(`${rank}. ${sales.address} ${sales.label} - ${totalFormatted} tokens (${formatUSD(totalFormatted)})`);
  });
}

// Exécuter l'analyse
analyzeSales();

