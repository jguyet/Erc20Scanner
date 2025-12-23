// Configuration du scanner Ethereum
export const config = {
  // Adresse du token ERC20 à scanner
  tokenAddress: '0x970a341B4E311A5c7248Dc9c3d8d4f35fEdFA73e',
  
  // Block de départ pour le scan (à modifier selon vos besoins)
  startBlock: 23970798, // Remplacez par le numéro de block souhaité
  
  // URL RPC Ethereum (utilise une RPC publique par défaut)
  rpcUrl: 'https://ethereum-rpc.publicnode.com', // RPC publique gratuite
  
  // Chemin du fichier de stockage
  dataFile: './data/transfers.json',
  
  // Nombre de blocks à scanner par batch (pour éviter les timeouts)
  batchSize: 1000,
  
  // Prix du token en dollars (par défaut 0.02$)
  tokenPriceUSD: 0.02
};

