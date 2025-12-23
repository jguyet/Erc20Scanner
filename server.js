import express from 'express';
import { loadData } from './storage.js';
import { config } from './config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Fonction pour charger les labels personnalisés
function loadLabels() {
  const labelsPath = path.join(__dirname, 'labels.json');
  try {
    if (fs.existsSync(labelsPath)) {
      const content = fs.readFileSync(labelsPath, 'utf-8');
      const rawLabels = JSON.parse(content);
      
      // Filtrer les clés de commentaire et normaliser les adresses en minuscules
      const labels = {};
      Object.entries(rawLabels).forEach(([key, value]) => {
        if (key !== '_comment' && typeof value === 'string') {
          // Stocker avec la clé en minuscules pour la recherche
          labels[key.toLowerCase()] = value;
          // Stocker aussi avec la clé originale au cas où
          labels[key] = value;
        }
      });
      
      console.log(`📋 ${Object.keys(labels).length} labels chargés`);
      return labels;
    }
  } catch (error) {
    console.error('Erreur lors du chargement des labels:', error);
  }
  return {};
}

// Servir les fichiers statiques depuis le dossier public
app.use(express.static(path.join(__dirname, 'public')));

// Route API pour récupérer les labels
app.get('/api/labels', (req, res) => {
  try {
    const labels = loadLabels();
    res.json({
      success: true,
      labels
    });
  } catch (error) {
    console.error('Erreur API /api/labels:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Route API pour récupérer les données
app.get('/api/data', (req, res) => {
  try {
    const data = loadData(config.dataFile);
    const labels = loadLabels();
    
    // Transformer les données pour le frontend
    const addresses = Object.entries(data.addresses || {}).map(([address, info]) => {
      // Chercher le label (essayer avec l'adresse originale et en minuscules)
      const label = labels[address] || labels[address.toLowerCase()] || null;
      
      return {
        address,
        in: info.in || '0',
        out: info.out || '0',
        balance: (BigInt(info.in || '0') - BigInt(info.out || '0')).toString(),
        transfers: info.transfers || [],
        label
      };
    });
    
    // Debug: compter les adresses avec labels
    const withLabels = addresses.filter(a => a.label);
    console.log(`🏷️ ${withLabels.length} adresses avec labels sur ${addresses.length} total`);
    
    res.json({
      success: true,
      addresses,
      total: addresses.length,
      tokenPriceUSD: config.tokenPriceUSD
    });
  } catch (error) {
    console.error('Erreur API /api/data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Route principale - servir index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🌐 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📊 Données chargées depuis: ${config.dataFile}`);
});

