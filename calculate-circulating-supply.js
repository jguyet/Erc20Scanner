import { loadData } from './storage.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Vérifier si un label contient "Helios"
function isHeliosAddress(label) {
  if (!label || typeof label !== 'string') {
    return false;
  }
  return label.toLowerCase().includes('helios');
}

// Normaliser un label pour regrouper les labels similaires
// Par exemple: "PAD - Spores disperse app locked 15k HLS" -> "PAD - Spores"
function normalizeLabel(label, allLabels) {
  if (!label || typeof label !== 'string') {
    return label;
  }
  
  // Chercher dans tous les labels un label "de base" qui correspond au début du label actuel
  // On cherche les labels qui sont des préfixes du label actuel
  const labelLower = label.toLowerCase().trim();
  
  // Trier les labels par longueur décroissante pour trouver le match le plus long
  const sortedLabels = Object.values(allLabels)
    .filter(l => l && typeof l === 'string' && l.trim())
    .map(l => l.trim())
    .sort((a, b) => b.length - a.length);
  
  // Chercher le label de base le plus long qui correspond au début du label actuel
  for (const baseLabel of sortedLabels) {
    const baseLabelLower = baseLabel.toLowerCase();
    // Si le label actuel commence par le label de base (et n'est pas exactement le même)
    if (labelLower.startsWith(baseLabelLower) && labelLower !== baseLabelLower) {
      // Vérifier qu'il y a un séparateur après (espace, tiret, etc.) pour éviter les faux positifs
      const nextChar = labelLower[baseLabelLower.length];
      if (nextChar === ' ' || nextChar === '-' || nextChar === undefined) {
        return baseLabel;
      }
    }
  }
  
  // Si aucun match trouvé, retourner le label original
  return label;
}

// Échapper les valeurs CSV (gérer les virgules et guillemets)
function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  // Si la valeur contient une virgule, des guillemets ou un saut de ligne, l'entourer de guillemets
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Exporter en CSV avec regroupement par label normalisé
function exportToCSV(groupedByLabel, TOTAL_SUPPLY) {
  const csvPath = path.resolve(__dirname, 'holders-export.csv');
  
  // Convertir la Map en tableau et trier par balance totale décroissante
  const groups = Array.from(groupedByLabel.values())
    .map(group => ({
      ...group,
      formattedTotalBalance: formatAmount(group.totalBalance.toString())
    }))
    .sort((a, b) => {
      return b.totalBalance > a.totalBalance ? 1 : b.totalBalance < a.totalBalance ? -1 : 0;
    })
    .slice(0, 100); // Limiter au top 100
  
  // Créer les lignes CSV
  const lines = [];
  
  // En-tête
  lines.push('Label (Normalisé),Adresses,Quantité Totale,Pourcentage Supply,Locked or Not Locked');
  
  // Données groupées
  groups.forEach((group) => {
    const percentage = (Number(group.totalBalance) / Number(TOTAL_SUPPLY)) * 100;
    const isLocked = isHeliosAddress(group.label) ? 'Locked' : 'Not Locked';
    const label = group.label || 'No label';
    
    // Créer une liste des adresses avec leurs labels originaux
    const addressesList = group.addresses
      .map(addr => {
        const originalLabel = addr.originalLabel && addr.originalLabel !== label 
          ? ` (${addr.originalLabel})` 
          : '';
        return `${addr.address}${originalLabel}`;
      })
      .join('; ');
    
    lines.push([
      escapeCSV(label),
      escapeCSV(addressesList),
      escapeCSV(group.formattedTotalBalance),
      escapeCSV(percentage.toFixed(6)),
      escapeCSV(isLocked)
    ].join(','));
  });
  
  // Écrire le fichier
  try {
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf-8');
    console.log(`\n✅ Export CSV créé: ${csvPath}`);
    console.log(`📊 Top ${groups.length} groupes de labels exportés\n`);
  } catch (error) {
    console.error('❌ Erreur lors de l\'export CSV:', error);
  }
}

// Calculer la circulating supply
function calculateCirculatingSupply(shouldExport = false) {
  console.log('🔍 Calcul de la Circulating Supply...\n');
  
  // Charger les données
  const data = loadData('data/transfers.json');
  const labels = loadLabels();
  
  if (!data.addresses) {
    console.error('❌ Aucune donnée trouvée');
    return;
  }
  
  // Total supply (5 milliards de tokens)
  const TOTAL_SUPPLY = BigInt('5000000000000000000000000000');
  
  let totalLocked = BigInt(0);
  let totalBurned = BigInt(0);
  const heliosAddresses = [];
  const allHolders = [];
  const groupedByLabel = new Map(); // Pour regrouper par label normalisé
  
  // Parcourir toutes les adresses
  Object.entries(data.addresses).forEach(([address, info]) => {
    const inAmount = BigInt(info.in || '0');
    const outAmount = BigInt(info.out || '0');
    const balance = inAmount - outAmount;
    
    // Ignorer les balances négatives ou nulles
    if (balance <= 0n) {
      return;
    }
    
    // Chercher le label (essayer avec l'adresse originale et en minuscules)
    const label = labels[address] || labels[address.toLowerCase()] || null;
    
    // Vérifier si c'est une adresse de burn
    if (address.toLowerCase() === '0x000000000000000000000000000000000000dead') {
      totalBurned += balance;
      return;
    }
    
    // Normaliser le label pour regrouper
    const normalizedLabel = normalizeLabel(label, labels);
    
    // Ajouter à la liste de tous les holders (avec le label original pour référence)
    allHolders.push({
      address,
      label,
      normalizedLabel,
      balance: balance.toString(),
      formattedBalance: formatAmount(balance.toString())
    });
    
    // Regrouper par label normalisé
    if (!groupedByLabel.has(normalizedLabel)) {
      groupedByLabel.set(normalizedLabel, {
        label: normalizedLabel,
        totalBalance: BigInt(0),
        addresses: []
      });
    }
    const group = groupedByLabel.get(normalizedLabel);
    group.totalBalance += balance;
    group.addresses.push({
      address,
      originalLabel: label,
      balance: balance.toString(),
      formattedBalance: formatAmount(balance.toString())
    });
    
    // Vérifier si c'est une adresse Helios (locked)
    if (isHeliosAddress(label)) {
      totalLocked += balance;
      heliosAddresses.push({
        address,
        label,
        balance: balance.toString(),
        formattedBalance: formatAmount(balance.toString())
      });
    }
  });
  
  // Calculer la circulating supply
  const circulatingSupply = TOTAL_SUPPLY - totalLocked - totalBurned;
  
  // Afficher les résultats
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 CIRCULATING SUPPLY ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log(`💰 Total Supply: ${formatAmount(TOTAL_SUPPLY.toString())} tokens`);
  console.log(`🔒 Locked (Helios addresses): ${formatAmount(totalLocked.toString())} tokens`);
  console.log(`🔥 Burned: ${formatAmount(totalBurned.toString())} tokens`);
  console.log(`\n✨ Circulating Supply: ${formatAmount(circulatingSupply.toString())} tokens\n`);
  
  // Pourcentage
  const lockedPercentage = (Number(totalLocked) / Number(TOTAL_SUPPLY)) * 100;
  const burnedPercentage = (Number(totalBurned) / Number(TOTAL_SUPPLY)) * 100;
  const circulatingPercentage = (Number(circulatingSupply) / Number(TOTAL_SUPPLY)) * 100;
  
  console.log('📈 Pourcentages:');
  console.log(`   Locked: ${lockedPercentage.toFixed(2)}%`);
  console.log(`   Burned: ${burnedPercentage.toFixed(2)}%`);
  console.log(`   Circulating: ${circulatingPercentage.toFixed(2)}%\n`);
  
  // Détails des adresses Helios
  if (heliosAddresses.length > 0) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`🔒 Adresses Helios (Locked) - ${heliosAddresses.length} adresses`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Trier par balance décroissante
    heliosAddresses.sort((a, b) => {
      const balanceA = BigInt(a.balance);
      const balanceB = BigInt(b.balance);
      return balanceB > balanceA ? 1 : balanceB < balanceA ? -1 : 0;
    });
    
    heliosAddresses.forEach((addr, index) => {
      const percentage = (Number(addr.balance) / Number(TOTAL_SUPPLY)) * 100;
      console.log(`${index + 1}. ${addr.label || 'No label'}`);
      console.log(`   Adresse: ${addr.address}`);
      console.log(`   Balance: ${addr.formattedBalance} tokens (${percentage.toFixed(2)}%)`);
      console.log('');
    });
  }
  
  // Afficher les groupes par label normalisé
  if (groupedByLabel.size > 0) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`📊 GROUPES PAR LABEL (Normalisés)`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Convertir en tableau et trier par balance totale décroissante
    const groups = Array.from(groupedByLabel.values())
      .map(group => ({
        ...group,
        formattedTotalBalance: formatAmount(group.totalBalance.toString())
      }))
      .sort((a, b) => {
        return b.totalBalance > a.totalBalance ? 1 : b.totalBalance < a.totalBalance ? -1 : 0;
      });
    
    // Afficher les 50 premiers groupes
    const topGroups = groups.slice(0, 50);
    
    topGroups.forEach((group, index) => {
      const percentage = (Number(group.totalBalance) / Number(TOTAL_SUPPLY)) * 100;
      const labelText = group.label || 'No label';
      console.log(`${(index + 1).toString().padStart(3, ' ')}. ${labelText}`);
      console.log(`     Balance totale: ${group.formattedTotalBalance} tokens (${percentage.toFixed(4)}%)`);
      console.log(`     Nombre d'adresses: ${group.addresses.length}`);
      if (group.addresses.length > 1) {
        console.log(`     Adresses:`);
        group.addresses.forEach(addr => {
          const originalLabel = addr.originalLabel && addr.originalLabel !== group.label 
            ? ` (${addr.originalLabel})` 
            : '';
          console.log(`       - ${addr.address}${originalLabel}: ${addr.formattedBalance} tokens`);
        });
      } else if (group.addresses.length === 1) {
        console.log(`     Adresse: ${group.addresses[0].address}`);
      }
      console.log('');
    });
    
    console.log(`\n📊 Total groupes: ${groups.length}`);
    console.log(`📊 Total holders avec balance > 0: ${allHolders.length}`);
  }
  
  // Afficher les 100 premiers holders individuels
  if (allHolders.length > 0) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`🏆 TOP 100 HOLDERS (Individuels)`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Trier par balance décroissante
    allHolders.sort((a, b) => {
      const balanceA = BigInt(a.balance);
      const balanceB = BigInt(b.balance);
      return balanceB > balanceA ? 1 : balanceB < balanceA ? -1 : 0;
    });
    
    // Prendre les 100 premiers
    const top100 = allHolders.slice(0, 100);
    
    top100.forEach((holder, index) => {
      const percentage = (Number(holder.balance) / Number(TOTAL_SUPPLY)) * 100;
      const labelText = holder.label ? ` (${holder.label})` : '';
      console.log(`${(index + 1).toString().padStart(3, ' ')}. ${holder.address}${labelText}`);
      console.log(`     Balance: ${holder.formattedBalance} tokens (${percentage.toFixed(4)}%)`);
      console.log('');
    });
  }
  
  // Exporter en CSV si demandé
  if (shouldExport) {
    exportToCSV(groupedByLabel, TOTAL_SUPPLY);
  }
  
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Vérifier les arguments de ligne de commande
const args = process.argv.slice(2);
const shouldExport = args.includes('--export');

// Exécuter le calcul
calculateCirculatingSupply(shouldExport);

