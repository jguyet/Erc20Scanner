import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Charge les données depuis le fichier JSON
 */
export function loadData(dataFile) {
  const filePath = path.resolve(__dirname, dataFile);
  
  // Créer le dossier data s'il n'existe pas
  const dataDir = path.dirname(filePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Si le fichier n'existe pas, retourner une structure vide
  if (!fs.existsSync(filePath)) {
    return { addresses: {} };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Erreur lors de la lecture du fichier:', error);
    return { addresses: {} };
  }
}

/**
 * Sauvegarde les données dans le fichier JSON
 */
export function saveData(data, dataFile) {
  const filePath = path.resolve(__dirname, dataFile);
  
  // Créer le dossier data s'il n'existe pas
  const dataDir = path.dirname(filePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Erreur lors de l\'écriture du fichier:', error);
    return false;
  }
}

/**
 * Ajoute un transfer à la base de données
 * Vérifie les doublons par txHash avant d'ajouter
 */
export function addTransfer(data, from, to, amount, blockNumber, txHash) {
  if (!data.addresses) {
    data.addresses = {};
  }
  
  // Normaliser le txHash en minuscules
  const normalizedTxHash = txHash ? txHash.toLowerCase() : null;
  
  // Vérifier si ce transfer existe déjà (par txHash)
  let transferExists = false;
  if (normalizedTxHash) {
    // Vérifier dans les transfers de l'adresse FROM
    if (from && data.addresses[from] && data.addresses[from].transfers) {
      transferExists = data.addresses[from].transfers.some(t => 
        t.txHash && t.txHash.toLowerCase() === normalizedTxHash
      );
    }
    // Vérifier aussi dans les transfers de l'adresse TO si pas trouvé
    if (!transferExists && to && data.addresses[to] && data.addresses[to].transfers) {
      transferExists = data.addresses[to].transfers.some(t => 
        t.txHash && t.txHash.toLowerCase() === normalizedTxHash
      );
    }
  }
  
  // Si le transfer existe déjà, ne pas l'ajouter
  if (transferExists) {
    return data;
  }
  
  // Gérer l'adresse FROM (OUT)
  if (from && from !== '0x0000000000000000000000000000000000000000') {
    if (!data.addresses[from]) {
      data.addresses[from] = { in: '0', out: '0', transfers: [] };
    }
    const currentOut = BigInt(data.addresses[from].out || '0');
    data.addresses[from].out = (currentOut + BigInt(amount)).toString();
    data.addresses[from].transfers.push({
      type: 'out',
      to,
      amount: amount.toString(),
      blockNumber,
      txHash: normalizedTxHash || txHash
    });
  }
  
  // Gérer l'adresse TO (IN)
  if (to && to !== '0x0000000000000000000000000000000000000000') {
    if (!data.addresses[to]) {
      data.addresses[to] = { in: '0', out: '0', transfers: [] };
    }
    const currentIn = BigInt(data.addresses[to].in || '0');
    data.addresses[to].in = (currentIn + BigInt(amount)).toString();
    data.addresses[to].transfers.push({
      type: 'in',
      from,
      amount: amount.toString(),
      blockNumber,
      txHash: normalizedTxHash || txHash
    });
  }
  
  return data;
}

