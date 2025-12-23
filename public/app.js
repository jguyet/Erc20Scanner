// Configuration
const API_URL = '/api/data';

// Variables globales
let addressesData = [];
let groupedAddressesData = []; // Données regroupées par label
let addressToGroupMap = null; // Map pour mapper les adresses vers leurs groupes
let simulation = null;
let selectedAddress = null;
let allNodes = null;
let allBubbles = null;
let allLinks = null;
let allLabels = null;
let searchFilterActive = false;
let searchConnectedNodes = new Set();
let allLinksData = []; // Stocker tous les liens pour la recherche
let searchDepth = 10; // Profondeur maximale de recherche par défaut
let parentChildGraph = null; // Graphe directionnel parent -> enfant
let tokenPriceUSD = 0.02; // Prix du token en dollars (par défaut)
let knownTxHashes = new Set(); // Set des txHash déjà vus pour détecter les nouveaux transfers
let knownAddresses = new Map(); // Map des adresses avec leurs balances pour détecter les changements
let labelsOnlyFilterActive = false; // Filtre pour afficher uniquement les labels
let padOnlyFilterActive = false; // Filtre pour afficher uniquement les labels "PAD -"
let sizeFilterMin = 0; // Filtre de taille minimum (en pourcentage)
let sizeFilterMax = 100; // Filtre de taille maximum (en pourcentage)
let minRadius = 2; // Rayon minimum des bulles (2px)
let maxRadius = 50; // Rayon maximum des bulles (sera calculé dynamiquement)
const TOTAL_SUPPLY = BigInt('5000000000000000000000000000'); // 5 milliards de tokens avec 18 décimales
const MIN_LABEL_RADIUS = 10; // Taille minimum de bulle pour afficher un label (en pixels)
let timelinePosition = 100; // Position de la timeline (0-100%, 100% = toutes les données)
let minBlockNumber = 0; // BlockNumber minimum de tous les transfers
let maxBlockNumber = 0; // BlockNumber maximum de tous les transfers
let originalAddressesData = []; // Stocker les données originales pour le filtrage temporel
let timelinePlaying = false; // État de lecture automatique
let timelineInterval = null; // Interval pour l'avancement automatique
let timelineSpeed = 0.5; // Vitesse d'avancement (pourcentage par seconde)
let timelineDirection = -1; // Direction de la timeline: -1 = remonter (vers le passé), 1 = avancer (vers le futur)

// Fonction pour formater les montants (wei vers tokens)
function formatAmount(weiAmount, decimals = 18, showUSD = true) {
  const amount = BigInt(weiAmount);
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;
  
  let amountStr;
  if (remainder === 0n) {
    amountStr = whole.toString();
  } else {
    const remainderStr = remainder.toString().padStart(decimals, '0');
    const trimmed = remainderStr.replace(/0+$/, '');
    amountStr = trimmed ? `${whole}.${trimmed}` : whole.toString();
  }
  
  // Ajouter le prix en dollar si demandé
  if (showUSD && tokenPriceUSD > 0) {
    const amountNum = parseFloat(amountStr);
    const usdValue = amountNum * tokenPriceUSD;
    const usdFormatted = usdValue.toLocaleString('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${amountStr} (${usdFormatted})`;
  }
  
  return amountStr;
}

// Map pour stocker les labels par adresse
const addressLabels = new Map();

// Fonction pour obtenir le label d'une adresse
function getAddressLabel(address) {
  if (!address) return null;
  // Chercher dans addressesData d'abord
  const addrData = addressesData.find(a => 
    a.address.toLowerCase() === address.toLowerCase()
  );
  if (addrData && addrData.label) {
    return addrData.label;
  }
  // Chercher dans la map
  return addressLabels.get(address.toLowerCase()) || null;
}

// Fonction pour formater l'adresse avec son label si disponible
function formatAddress(address, showLabel = true) {
  if (!address) return '';
  // Retourner l'adresse complète (l'utilisateur a modifié pour ne pas tronquer)
  const addressText = address;
  if (showLabel) {
    const label = getAddressLabel(address);
    if (label) {
      return `${addressText} (${label})`;
    }
  }
  return addressText;
}

// Charger les données depuis l'API
async function loadData() {
  try {
    const response = await fetch(API_URL);
    const result = await response.json();
    
    if (result.success) {
      // Sauvegarder les données originales pour le filtrage temporel
      originalAddressesData = result.addresses;
      addressesData = result.addresses;
      tokenPriceUSD = result.tokenPriceUSD || 0.02; // Récupérer le prix depuis l'API
      document.getElementById('total-addresses').textContent = result.total;
      
      // Initialiser la map des labels
      addressLabels.clear();
      addressesData.forEach(addr => {
        if (addr.label) {
          addressLabels.set(addr.address.toLowerCase(), addr.label);
        }
      });
      
      // Calculer le min et max blockNumber de tous les transfers
      const allBlockNumbers = [];
      addressesData.forEach(addr => {
        if (addr.transfers) {
          addr.transfers.forEach(t => {
            if (t.blockNumber) {
              allBlockNumbers.push(t.blockNumber);
            }
          });
        }
      });
      
      if (allBlockNumbers.length > 0) {
        minBlockNumber = Math.min(...allBlockNumbers);
        maxBlockNumber = Math.max(...allBlockNumbers);
        console.log(`📅 Block range: ${minBlockNumber} - ${maxBlockNumber}`);
        
        // Initialiser le slider de timeline
        const timelineSlider = document.getElementById('timeline-slider');
        if (timelineSlider) {
          timelineSlider.max = 100;
          timelineSlider.value = 100; // Par défaut, toutes les données
          timelinePosition = 100;
          timelineDirection = -1; // Par défaut, remonter dans le temps
          updateTimelineDisplay(100);
        }
      }
      
      // Compter le total de transfers
      const totalTransfers = addressesData.reduce((sum, addr) => sum + (addr.transfers?.length || 0), 0);
      document.getElementById('total-transfers').textContent = totalTransfers;
      
      // Initialiser les sets de suivi pour la première fois
      if (knownTxHashes.size === 0) {
        addressesData.forEach(addr => {
          if (addr.transfers) {
            addr.transfers.forEach(t => {
              if (t.txHash) {
                knownTxHashes.add(t.txHash.toLowerCase());
              }
            });
          }
          knownAddresses.set(addr.address.toLowerCase(), {
            balance: addr.balance,
            in: addr.in,
            out: addr.out
          });
        });
      } else {
        // Détecter les nouveaux transfers et mettre à jour
        updateVisualizationWithNewTransfers(result.addresses);
      }
      
      // Masquer le loading et afficher la visualisation
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('visualization').classList.remove('hidden');
      
      // Créer la bubble map seulement la première fois
      if (!allBubbles) {
        createBubbleMap();
      }
    } else {
      throw new Error(result.error || 'Erreur lors du chargement des données');
    }
  } catch (error) {
    console.error('Erreur:', error);
    document.getElementById('loading').innerHTML = `<p style="color: #ef4444;">Erreur: ${error.message}</p>`;
  }
}

// Fonction pour regrouper les adresses par label
function groupAddressesByLabel(addressesData) {
  const labelGroups = new Map(); // Map<label, addresses[]>
  const unlabeledAddresses = []; // Adresses sans label
  
  // Créer une map pour mapper les adresses originales vers leurs groupes
  const addressToGroupMap = new Map(); // Map<address, groupKey>
  
  addressesData.forEach(addr => {
    const label = addr.label || getAddressLabel(addr.address);
    
    if (label) {
      // Adresse avec label - regrouper
      if (!labelGroups.has(label)) {
        labelGroups.set(label, []);
      }
      labelGroups.get(label).push(addr);
      addressToGroupMap.set(addr.address.toLowerCase(), label);
    } else {
      // Adresse sans label - garder individuelle
      unlabeledAddresses.push(addr);
      addressToGroupMap.set(addr.address.toLowerCase(), addr.address.toLowerCase());
    }
  });
  
  // Créer les groupes agrégés
  const groupedData = [];
  
  // Ajouter les groupes avec labels
  labelGroups.forEach((addresses, label) => {
    // Agréger les données
    let totalIn = 0n;
    let totalOut = 0n;
    let totalBalance = 0n;
    const allTransfers = [];
    const allAddresses = [];
    
    addresses.forEach(addr => {
      totalIn += BigInt(addr.in || '0');
      totalOut += BigInt(addr.out || '0');
      totalBalance += BigInt(addr.balance || '0');
      if (addr.transfers) {
        allTransfers.push(...addr.transfers);
      }
      allAddresses.push(addr.address);
    });
    
    groupedData.push({
      address: label, // Utiliser le label comme identifiant
      label: label,
      in: totalIn.toString(),
      out: totalOut.toString(),
      balance: totalBalance.toString(),
      transfers: allTransfers,
      addresses: allAddresses, // Garder la liste des adresses originales
      isGroup: true
    });
  });
  
  // Ajouter les adresses sans label individuellement
  unlabeledAddresses.forEach(addr => {
    groupedData.push({
      ...addr,
      isGroup: false
    });
  });
  
  console.log(`📦 Regroupement: ${labelGroups.size} groupes de labels, ${unlabeledAddresses.length} adresses sans label`);
  console.log(`📊 Total après regroupement: ${groupedData.length} bulles (au lieu de ${addressesData.length})`);
  
  return { groupedData, addressToGroupMap };
}

// Construire le graphe de connexions à partir des transfers
function buildConnectionGraph(addressesData, addressToGroupMap = null, groupedData = null) {
  // Si on a un map de regroupement, l'utiliser pour mapper les adresses vers leurs groupes
  const useGrouping = addressToGroupMap !== null && groupedData !== null;
  
  // Créer un index des groupes/adresses par leur identifiant (basé sur groupedData si disponible)
  const addressMap = new Map();
  if (useGrouping && groupedData) {
    // Utiliser les indices de groupedData
    groupedData.forEach((addr, i) => {
      const key = addr.isGroup ? addr.label : addr.address.toLowerCase();
      addressMap.set(key, i);
    });
    console.log(`🗺️ Index créé avec ${addressMap.size} groupes/adresses depuis groupedData`);
    // Debug: afficher quelques exemples de clés
    const sampleKeys = Array.from(addressMap.keys()).slice(0, 5);
    console.log(`   Exemples de clés:`, sampleKeys);
  } else {
    // Utiliser les indices de addressesData (ancien comportement)
    addressesData.forEach((addr, i) => {
      const key = addr.address.toLowerCase();
      addressMap.set(key, i);
    });
    console.log(`🗺️ Index créé avec ${addressMap.size} adresses depuis addressesData`);
  }
  
  // Créer les liens à partir des transfers
  const linkMap = new Map(); // Pour éviter les doublons et agréger les montants
  let processedTransfers = 0;
  let validLinks = 0;
  
  addressesData.forEach((addr) => {
    const sourceKey = useGrouping && addressToGroupMap
      ? (addressToGroupMap.get(addr.address.toLowerCase()) || addr.address.toLowerCase())
      : addr.address.toLowerCase();
    
    // Obtenir l'index du groupe/adresse dans groupedData
    const sourceIndex = addressMap.get(sourceKey);
    if (sourceIndex === undefined) {
      // Debug: afficher pourquoi la source n'est pas trouvée
      if (processedTransfers < 10) { // Limiter les logs
        console.warn(`⚠️ Source non trouvée dans addressMap: ${sourceKey} (adresse: ${addr.address})`);
      }
      return; // Ignorer si la source n'est pas dans le map
    }
    
    (addr.transfers || []).forEach(transfer => {
      processedTransfers++;
      let targetAddress = null;
      
      // Pour un transfer "out", la cible est dans "to"
      if (transfer.type === 'out' && transfer.to) {
        targetAddress = transfer.to.toLowerCase();
      } 
      // Pour un transfer "in", la source est dans "from"
      else if (transfer.type === 'in' && transfer.from) {
        targetAddress = transfer.from.toLowerCase();
      }
      
      if (targetAddress) {
        // Mapper l'adresse cible vers son groupe si on utilise le regroupement
        const targetKey = useGrouping && addressToGroupMap
          ? (addressToGroupMap.get(targetAddress) || targetAddress)
          : targetAddress;
        
        // Ignorer les adresses zero et celles qui ne sont pas dans nos données
        if (targetKey && 
            targetKey !== '0x0000000000000000000000000000000000000000' &&
            targetKey !== '0x000000000000000000000000000000000000dead' &&
            addressMap.has(targetKey)) {
          const targetIndex = addressMap.get(targetKey);
          
          // Éviter les auto-connexions
          if (sourceIndex === targetIndex) {
            return;
          }
          
          // Créer une clé unique pour le lien (ordre alphabétique pour éviter les doublons)
          const linkKey = sourceIndex < targetIndex 
            ? `${sourceIndex}-${targetIndex}`
            : `${targetIndex}-${sourceIndex}`;
          
          if (!linkMap.has(linkKey)) {
            linkMap.set(linkKey, {
              source: sourceIndex,
              target: targetIndex,
              value: 0n,
              count: 0
            });
            validLinks++;
          }
          
          const link = linkMap.get(linkKey);
          link.value += BigInt(transfer.amount || '0');
          link.count += 1;
        }
      }
    });
  });
  
  console.log(`📝 ${processedTransfers} transfers traités, ${validLinks} liens uniques créés`);
  
  // Convertir les valeurs BigInt en nombres pour D3
  const links = Array.from(linkMap.values()).map(link => ({
    source: link.source,
    target: link.target,
    value: Number(link.value),
    count: link.count
  }));
  
  return links;
}

  // Algorithme de clustering simple (Union-Find) pour identifier les groupes
  function findConnectedComponents(nodes, links) {
    const parent = nodes.map((_, i) => i);
    
    function find(x) {
      if (parent[x] !== x) {
        parent[x] = find(parent[x]);
      }
      return parent[x];
    }
    
    function union(x, y) {
      const rootX = find(x);
      const rootY = find(y);
      if (rootX !== rootY) {
        parent[rootY] = rootX;
      }
    }
    
    // Unir tous les nœuds connectés (les liens ont des indices au début)
    links.forEach(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      union(sourceId, targetId);
    });
    
    // Assigner un groupe à chaque nœud
    const groups = new Map();
    nodes.forEach((node, i) => {
      const root = find(i);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root).push(i);
      node.group = root;
    });
    
    return groups;
  }

// Variable pour le filtre des balances à 0
let hideOutBubbles = true;

// Fonction pour appliquer le filtre (ancienne fonction, maintenant utilise updateVisualization)
function applyFilter() {
  updateVisualization();
}

// Créer la bubble map avec D3.js
function createBubbleMap() {
  const svg = d3.select('#bubble-map');
  svg.selectAll('*').remove();
  
  // Calculer la taille en fonction de la fenêtre
  const headerHeight = document.querySelector('header').offsetHeight;
  const width = window.innerWidth;
  const height = window.innerHeight - headerHeight;
  
  svg.attr('width', width).attr('height', height);
  
  // Calculer la taille maximum basée sur la taille d'écran
  // Taille max = min(width, height) / 10
  const screenSize = Math.min(width, height);
  maxRadius = screenSize / 10;
  minRadius = 2; // Taille minimum fixe de 2px
  
  console.log(`📏 Taille d'écran: ${screenSize}px, Rayon max: ${maxRadius}px, Rayon min: ${minRadius}px`);
  
  // Regrouper les adresses par label
  const { groupedData, addressToGroupMap: groupMap } = groupAddressesByLabel(addressesData);
  groupedAddressesData = groupedData;
  addressToGroupMap = groupMap;
  
  // Calculer les tailles des bulles basées sur la balance nette proportionnelle au TOTAL_SUPPLY
  const balances = groupedData.map(addr => {
    const balance = BigInt(addr.balance);
    const absBalance = balance < 0n ? -balance : balance;
    return {
      ...addr, // Cela inclut le label si présent
      absBalance: absBalance, // Garder en BigInt pour la précision
      isPositive: balance >= 0n
    };
  });
  
  // Debug: vérifier que les labels sont présents
  const balancesWithLabels = balances.filter(b => b.label);
  console.log('🔍 Labels dans balances:', balancesWithLabels.length, 'sur', balances.length);
  if (balancesWithLabels.length > 0) {
    console.log('Exemples:', balancesWithLabels.slice(0, 3).map(b => ({ address: b.address, label: b.label })));
  }
  
  // Trouver le max pour le debug
  const maxBalance = d3.max(balances, d => Number(d.absBalance));
  const minBalance = d3.min(balances, d => Number(d.absBalance));
  
  console.log(`📊 Balance range: min=${minBalance}, max=${maxBalance}`);
  console.log(`💰 TOTAL_SUPPLY: ${TOTAL_SUPPLY.toString()}`);
  
  // Créer les nœuds pour la simulation avec taille proportionnelle au TOTAL_SUPPLY
  const nodes = balances.map((addr, i) => {
    const absBalance = addr.absBalance; // BigInt
    
    // Vérifier si l'adresse a un label
    const hasLabel = addr.label || getAddressLabel(addr.address);
    
    // Calculer le radius proportionnellement à la balance par rapport au TOTAL_SUPPLY
    // Formule: radius = minRadius + (balance / TOTAL_SUPPLY) * (maxRadius - minRadius)
    let radius;
    if (absBalance === 0n) {
      radius = minRadius; // Taille minimale pour balance à 0
    } else {
      // Calculer la proportion (balance / TOTAL_SUPPLY)
      // Utiliser Number pour le calcul mais avec précision
      const balanceNum = Number(absBalance);
      const totalSupplyNum = Number(TOTAL_SUPPLY);
      const proportion = balanceNum / totalSupplyNum;
      
      // Calculer le radius proportionnellement
      radius = minRadius + (proportion * (maxRadius - minRadius));
      
      // S'assurer que le radius est dans les limites
      radius = Math.max(minRadius, Math.min(maxRadius, radius));
    }
    
    // Si la bulle a un label, s'assurer qu'elle a au moins MIN_LABEL_RADIUS
    if (hasLabel && radius < MIN_LABEL_RADIUS) {
      radius = MIN_LABEL_RADIUS;
    }
    
    return {
      id: i,
      address: addr.address,
      in: addr.in,
      out: addr.out,
      balance: addr.balance,
      transfers: addr.transfers || [],
      isPositive: addr.isPositive,
      label: addr.label || null, // Label personnalisé
      radius: radius,
      isGroup: addr.isGroup || false, // Indique si c'est un groupe
      addresses: addr.addresses || [] // Liste des adresses du groupe (si c'est un groupe)
    };
  });
  
  const radiusStats = {
    min: d3.min(nodes, d => d.radius),
    max: d3.max(nodes, d => d.radius),
    avg: d3.mean(nodes, d => d.radius)
  };
  console.log(`📏 Radius stats:`, radiusStats);
  console.log(`📏 Radius calculé - min: ${minRadius}px, max: ${maxRadius}px`);
  
  // Les valeurs minRadius et maxRadius sont déjà définies globalement
  
  // Mettre à jour les sliders avec les nouvelles valeurs
  const sizeFilterMinInput = document.getElementById('size-filter-min');
  const sizeFilterMaxInput = document.getElementById('size-filter-max');
  if (sizeFilterMinInput && sizeFilterMaxInput) {
    sizeFilterMinInput.max = 100;
    sizeFilterMaxInput.max = 100;
    sizeFilterMinInput.value = 0;
    sizeFilterMaxInput.value = 100;
    sizeFilterMin = 0;
    sizeFilterMax = 100;
    updateSizeFilterDisplay();
  }
  
  // Construire le graphe de connexions (avec indices) en utilisant les données regroupées
  // Note: on passe les données originales pour les transfers, mais avec le map de regroupement
  const linksData = buildConnectionGraph(addressesData, groupMap, groupedData);
  console.log(`🔗 ${linksData.length} liens créés`);
  
  // Identifier les groupes connectés (avant de convertir les indices en références)
  const groups = findConnectedComponents(nodes, linksData);
  console.log(`📊 ${groups.size} groupes connectés identifiés`);
  console.log(`📦 ${nodes.length} nœuds au total`);
  
  // Mettre à jour l'affichage du nombre de groupes
  document.getElementById('total-groups').textContent = groups.size;
  
  // Convertir les indices en références aux nœuds pour D3
  // Filtrer les liens invalides (nœuds manquants)
  const links = linksData
    .filter(link => {
      const sourceNode = nodes[link.source];
      const targetNode = nodes[link.target];
      if (!sourceNode || !targetNode) {
        console.warn(`⚠️ Lien invalide ignoré: source=${link.source} (${sourceNode ? 'OK' : 'MANQUANT'}), target=${link.target} (${targetNode ? 'OK' : 'MANQUANT'})`);
        return false;
      }
      return true;
    })
    .map(link => ({
      source: nodes[link.source],
      target: nodes[link.target],
      value: link.value,
      count: link.count
    }));
  
  // Calculer le nombre de connexions (degrés) pour chaque nœud
  const nodeConnections = new Map();
  nodes.forEach(node => {
    nodeConnections.set(node.id, 0);
  });
  
  linksData.forEach(link => {
    nodeConnections.set(link.source, (nodeConnections.get(link.source) || 0) + 1);
    nodeConnections.set(link.target, (nodeConnections.get(link.target) || 0) + 1);
  });
  
  // Calculer la détention (balance absolue) pour chaque nœud
  const maxHolderBalance = Math.max(...nodes.map(n => Number(BigInt(n.balance) < 0n ? -BigInt(n.balance) : BigInt(n.balance))), 1);
  const maxNodeRadius = Math.max(...nodes.map(n => n.radius), 1);
  
  nodes.forEach(node => {
    const balance = BigInt(node.balance);
    const absBalance = balance < 0n ? -balance : balance;
    // Score basé uniquement sur la détention (taille du holder)
    node.holderScore = Number(absBalance) / maxHolderBalance; // Normalisé 0-1
    node.connectionCount = nodeConnections.get(node.id) || 0;
  });
  
  // Trier les nœuds par détention (holders les plus gros au centre)
  const sortedNodes = [...nodes].sort((a, b) => b.holderScore - a.holderScore);
  
  // Assigner des positions initiales basées sur la détention
  const margin = 50;
  const availableWidth = width - 2 * margin;
  const availableHeight = height - 2 * margin;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDistanceFromCenter = Math.min(availableWidth, availableHeight) / 2;
  
  // Positionner les nœuds en spirale depuis le centre
  // Les plus gros holders au centre, les plus petits s'éloignent
  sortedNodes.forEach((node, index) => {
    // Distance du centre basée uniquement sur la détention
    // Gros holder (score élevé) = proche du centre
    // Petit holder (score faible) = loin du centre
    const distanceFromCenter = (1 - node.holderScore) * maxDistanceFromCenter * 0.85;
    
    // Angle en spirale pour éviter les chevauchements
    const angle = (index * 137.5) * (Math.PI / 180); // Angle d'or pour une spirale équidistante
    
    // Position finale
    node.x = centerX + distanceFromCenter * Math.cos(angle);
    node.y = centerY + distanceFromCenter * Math.sin(angle);
    
    // S'assurer que la position est dans les limites
    const r = node.radius;
    node.x = Math.max(margin + r, Math.min(width - margin - r, node.x));
    node.y = Math.max(margin + r, Math.min(height - margin - r, node.y));
    
    node.vx = 0;
    node.vy = 0;
  });
  
  console.log(`📍 ${sortedNodes.length} nœuds positionnés par détention`);
  console.log(`🏆 Top 5 holders:`, sortedNodes.slice(0, 5).map(n => ({
    address: formatAddress(n.address),
    holderScore: n.holderScore.toFixed(3),
    connections: n.connectionCount
  })));
  
  // Simulation de force avec liens - optimisée pour regrouper les connexions
  simulation = d3.forceSimulation(nodes)
    .force('charge', d3.forceManyBody().strength(-80)) // Réduire la répulsion pour permettre le regroupement
    .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05)) // Réduire la force centrifuge
    .force('collision', d3.forceCollide().radius(d => d.radius + 1)) // Réduire l'espace entre les bulles
    .force('boundary', (alpha) => {
      // Force de confinement pour garder les nœuds dans les limites
      nodes.forEach(node => {
        const r = node.radius;
        if (node.x - r < margin) {
          node.vx += (margin + r - node.x) * alpha;
          node.x = margin + r;
        } else if (node.x + r > width - margin) {
          node.vx += (width - margin - r - node.x) * alpha;
          node.x = width - margin - r;
        }
        if (node.y - r < margin) {
          node.vy += (margin + r - node.y) * alpha;
          node.y = margin + r;
        } else if (node.y + r > height - margin) {
          node.vy += (height - margin - r - node.y) * alpha;
          node.y = height - margin - r;
        }
      });
    });
  
  // Ajouter la force de lien seulement s'il y a des liens - FORCE TRÈS FORTE pour garder les connexions proches
  if (links.length > 0) {
    simulation.force('link', d3.forceLink(links)
      .id(d => d.id)
      // Distance très courte pour garder les connexions proches
      .distance(d => {
        // Distance basée sur la taille des nœuds - très proche
        const sourceRadius = typeof d.source === 'object' ? d.source.radius : nodes[d.source].radius;
        const targetRadius = typeof d.target === 'object' ? d.target.radius : nodes[d.target].radius;
        // Distance minimale = juste assez pour éviter le chevauchement
        const minDistance = sourceRadius + targetRadius + 5;
        // Distance maximale très courte pour garder les connexions proches
        const maxDistance = minDistance * 1.5;
        // Plus de connexions = distance encore plus courte
        const connectionFactor = Math.min(1, 1 / Math.log10(d.count + 2));
        return minDistance + (maxDistance - minDistance) * connectionFactor;
      })
      .strength(1.0)); // Force maximale pour garder les connexions très proches
  }
  
  // Ajouter une force supplémentaire pour regrouper les nœuds directement connectés
  if (links.length > 0) {
    simulation.force('attractConnected', (alpha) => {
      // Force très forte pour rapprocher les nœuds directement connectés
      links.forEach(link => {
        const source = typeof link.source === 'object' ? link.source : nodes[link.source];
        const target = typeof link.target === 'object' ? link.target : nodes[link.target];
        
        if (source && target) {
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const minDistance = source.radius + target.radius + 8; // Distance cible très courte
          
          if (distance > minDistance) {
            // Attirer fortement les nœuds connectés s'ils sont trop éloignés
            const force = (distance - minDistance) * 0.3 * alpha; // Force augmentée
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;
            
            source.vx += fx;
            source.vy += fy;
            target.vx -= fx;
            target.vy -= fy;
          }
        }
      });
    });
  }
  
  // Ajouter la force de groupe seulement s'il y a des groupes
  if (groups.size > 0) {
    simulation.force('group', (alpha) => {
      // Force pour regrouper les nœuds du même groupe
      groups.forEach((groupNodes, groupId) => {
        if (groupNodes.length > 1) {
          // Calculer le centre de gravité du groupe basé sur les positions actuelles
          let centerX = 0, centerY = 0, count = 0;
          groupNodes.forEach(nodeId => {
            const node = nodes[nodeId];
            centerX += node.x;
            centerY += node.y;
            count++;
          });
          if (count > 0) {
            centerX /= count;
            centerY /= count;
          }
          
          groupNodes.forEach(nodeId => {
            const node = nodes[nodeId];
            // Attirer vers le centre du groupe
            const dx = centerX - node.x;
            const dy = centerY - node.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 0) {
              // Force pour regrouper les nœuds connectés
              const force = Math.min(distance, 100) * 0.15 * alpha;
              node.vx += (dx / distance) * force;
              node.vy += (dy / distance) * force;
            }
          });
        }
      });
    });
  }
  
  // Construire le graphe parent-enfant AVANT de l'utiliser
  const parentChildGraphLocal = buildParentChildGraph(addressesData, groupMap);
  
  // Créer un index des pads (labels commençant par "PAD -")
  const padNodes = new Map(); // Map<nodeId, padNode>
  const padChildren = new Map(); // Map<padNodeId, Set<childNodeId>>
  
  // Identifier tous les nœuds avec des labels "PAD -"
  nodes.forEach(node => {
    const label = node.label || getAddressLabel(node.address);
    if (label && label.startsWith('PAD -')) {
      padNodes.set(node.id, node);
      padChildren.set(node.id, new Set());
    }
  });
  
  // Fonction récursive pour trouver tous les enfants d'un nœud (jusqu'à trouver un label)
  function findChildrenRecursive(nodeId, visited = new Set(), depth = 0) {
    if (visited.has(nodeId) || depth > 10) return new Set();
    visited.add(nodeId);
    
    const children = new Set();
    if (!parentChildGraphLocal) return children;
    
    const directChildren = parentChildGraphLocal.get(nodeId);
    
    if (directChildren) {
      directChildren.forEach(childId => {
        const childNode = nodes[childId];
        if (childNode) {
          const childLabel = childNode.label || getAddressLabel(childNode.address);
          
          // Si l'enfant n'a pas de label, l'ajouter et continuer récursivement
          if (!childLabel) {
            children.add(childId);
            // Récursivement trouver les enfants de cet enfant
            const grandChildren = findChildrenRecursive(childId, new Set(visited), depth + 1);
            grandChildren.forEach(gc => children.add(gc));
          }
        }
      });
    }
    
    return children;
  }
  
  // Pour chaque pad, trouver tous ses enfants (directs et indirects sans labels)
  padNodes.forEach((padNode, padId) => {
    const children = findChildrenRecursive(padId);
    padChildren.set(padId, children);
    console.log(`🔷 PAD "${padNode.label || getAddressLabel(padNode.address)}" a ${children.size} enfants`);
  });
  
  // Ajouter une force pour regrouper les enfants autour de leur pad
  if (padNodes.size > 0) {
    simulation.force('padCluster', (alpha) => {
      padNodes.forEach((padNode, padId) => {
        const children = padChildren.get(padId);
        if (!children || children.size === 0) return;
        
        const padX = padNode.x;
        const padY = padNode.y;
        const padRadius = padNode.radius || 10;
        
        // Distance du cercle autour du pad (basée sur le nombre d'enfants)
        const circleRadius = Math.max(80, padRadius + 30 + Math.sqrt(children.size) * 15);
        
        // Calculer l'angle pour chaque enfant pour les placer en cercle
        const childrenArray = Array.from(children);
        childrenArray.forEach((childId, index) => {
          const childNode = nodes[childId];
          if (!childNode) return;
          
          // Angle pour placer l'enfant en cercle autour du pad
          const angle = (index / childrenArray.length) * 2 * Math.PI;
          const targetX = padX + circleRadius * Math.cos(angle);
          const targetY = padY + circleRadius * Math.sin(angle);
          
          // Force pour attirer l'enfant vers sa position cible
          const dx = targetX - childNode.x;
          const dy = targetY - childNode.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance > 0) {
            // Force forte pour regrouper autour du pad
            const force = distance * 0.4 * alpha;
            childNode.vx += (dx / distance) * force;
            childNode.vy += (dy / distance) * force;
          }
        });
        
        // Force pour garder le pad au centre (légèrement)
        const centerDx = padX - (width / 2);
        const centerDy = padY - (height / 2);
        const centerDistance = Math.sqrt(centerDx * centerDx + centerDy * centerDy);
        if (centerDistance > 0) {
          const centerForce = Math.min(centerDistance, 200) * 0.02 * alpha;
          padNode.vx += (centerDx / centerDistance) * centerForce;
          padNode.vy += (centerDy / centerDistance) * centerForce;
        }
      });
    });
  }
  
  // Le handler de tick sera défini après la création des bulles pour avoir accès à allBubbles
  
  // Créer les liens (lignes) - seulement s'il y en a
  let link;
  const linkSelection = svg.selectAll('.link').data(links);
  
  // Supprimer les liens qui n'existent plus
  linkSelection.exit()
    .transition()
    .duration(500)
    .style('opacity', 0)
    .remove();
  
  // Créer les nouveaux liens
  const newLinks = linkSelection.enter()
    .append('line')
    .attr('class', 'link')
    .attr('stroke', '#999')
    .attr('stroke-opacity', 0)
    .attr('stroke-width', d => Math.max(1, Math.min(3, Math.log10(d.value + 1) / 2)))
    .attr('x1', d => d.source.x || width / 2)
    .attr('y1', d => d.source.y || height / 2)
    .attr('x2', d => d.target.x || width / 2)
    .attr('y2', d => d.target.y || height / 2);
  
  // Animer l'apparition des nouveaux liens
  newLinks
    .transition()
    .duration(600)
    .ease(d3.easeCubicOut)
    .attr('stroke-opacity', 0.3);
  
  // Mettre à jour les liens existants
  linkSelection
    .transition()
    .duration(600)
    .ease(d3.easeCubicOut)
    .attr('stroke-width', d => Math.max(1, Math.min(3, Math.log10(d.value + 1) / 2)));
  
  // Fusionner les nouveaux et existants
  link = newLinks.merge(linkSelection);
  
  // Créer la fonction de drag (uniquement pour le bouton gauche)
  const drag = d3.drag()
    .filter(function(event) {
      // Ne permettre le drag qu'avec le bouton gauche de la souris
      // Vérifier si event.sourceEvent existe
      if (!event.sourceEvent) return true;
      // Bloquer le drag sur clic droit (button 2) et clic du milieu (button 1)
      if (event.button !== 0) return false;
      return true;
    })
    .on('start', function(event, d) {
      // Empêcher le menu contextuel si l'événement source existe
      if (event.sourceEvent) {
        event.sourceEvent.preventDefault();
      }
      
      // Arrêter la simulation pour ce nœud pendant le drag
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
      // Sauvegarder la position de départ pour détecter un clic simple
      d.dragStartX = event.x;
      d.dragStartY = event.y;
      d.dragStartTime = Date.now();
      d.dragged = false;
    })
    .on('drag', function(event, d) {
      // Calculer la distance parcourue
      const dx = event.x - d.dragStartX;
      const dy = event.y - d.dragStartY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Si le mouvement est supérieur à 5px, considérer comme un drag
      if (distance > 5) {
        d.dragged = true;
      }
      
      // Mettre à jour la position fixe du nœud
      const r = d.radius;
      d.fx = Math.max(margin + r, Math.min(width - margin - r, event.x));
      d.fy = Math.max(margin + r, Math.min(height - margin - r, event.y));
      
      // Mettre à jour visuellement
      d3.select(this)
        .attr('cx', d.fx)
        .attr('cy', d.fy);
      
      // Mettre à jour les labels correspondants (si ils existent)
      svg.selectAll('.bubble-label')
        .filter(function(label) { return label.id === d.id; })
        .attr('x', d.fx)
        .attr('y', d.fy);
      
      // Mettre à jour les liens
      if (links.length > 0) {
        link
          .filter(l => {
            const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
            const targetId = typeof l.target === 'object' ? l.target.id : l.target;
            return sourceId === d.id || targetId === d.id;
          })
          .attr('x1', l => {
            const source = typeof l.source === 'object' ? l.source : nodes[l.source];
            return source.fx !== undefined ? source.fx : source.x;
          })
          .attr('y1', l => {
            const source = typeof l.source === 'object' ? l.source : nodes[l.source];
            return source.fy !== undefined ? source.fy : source.y;
          })
          .attr('x2', l => {
            const target = typeof l.target === 'object' ? l.target : nodes[l.target];
            return target.fx !== undefined ? target.fx : target.x;
          })
          .attr('y2', l => {
            const target = typeof l.target === 'object' ? l.target : nodes[l.target];
            return target.fy !== undefined ? target.fy : target.y;
          });
      }
    })
    .on('end', function(event, d) {
      // Calculer le temps écoulé
      const timeElapsed = d.dragStartTime ? Date.now() - d.dragStartTime : 0;
      
      // Si ce n'était pas un drag (clic simple) et que moins de 300ms se sont écoulés
      if (!d.dragged && timeElapsed < 300 && timeElapsed > 0) {
        // Ouvrir la modal directement
        showAddressInfo(d);
        highlightConnections(d, links, allBubblesMerged, link);
      }
      
      // Réinitialiser la simulation
      if (!event.active) simulation.alphaTarget(0);
      
      // Libérer le nœud après un court délai pour permettre la stabilisation
      setTimeout(() => {
        d.fx = null;
        d.fy = null;
        d.dragged = false; // Réinitialiser pour le prochain clic
      }, 100);
    });
  
  // Fonction pour générer une couleur basée sur le nom du label (globale)
  window.getLabelColor = function(labelName) {
    if (!labelName) return null;
    
    // Hash simple du nom pour générer une couleur cohérente
    let hash = 0;
    for (let i = 0; i < labelName.length; i++) {
      hash = labelName.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Générer une couleur HSL avec saturation et luminosité fixes pour des couleurs vives
    const hue = Math.abs(hash) % 360;
    // Utiliser une saturation et luminosité qui donnent des couleurs vives mais lisibles
    const saturation = 65 + (Math.abs(hash) % 20); // Entre 65% et 85%
    const lightness = 45 + (Math.abs(hash) % 15); // Entre 45% et 60%
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };
  
  // Créer les bulles avec animation d'apparition pour les nouvelles
  const isUpdate = allBubbles && allBubbles.size() > 0;
  
  // Si c'est une mise à jour, utiliser la clé pour détecter les nouvelles
  // Sinon, créer toutes les bulles normalement
  const bubblesSelection = isUpdate 
    ? svg.selectAll('.bubble').data(nodes, d => d.address.toLowerCase())
    : svg.selectAll('.bubble').data(nodes);
  
  // Nouvelles bulles (enter) - animation d'apparition
  const newBubbles = bubblesSelection.enter()
    .append('circle')
    .attr('class', d => {
      const baseClass = `bubble ${d.isPositive ? 'positive' : 'negative'}`;
      return d.label ? `${baseClass} labeled` : baseClass;
    })
    .attr('r', isUpdate ? 0 : d => d.radius || 5) // 0 pour animation si mise à jour
    .attr('cx', d => d.x || width / 2)
    .attr('cy', d => d.y || height / 2)
    .style('fill', d => {
      // Si la bulle a un label, utiliser la couleur du label
      if (d.label) {
        return getLabelColor(d.label);
      }
      // Sinon, utiliser la couleur par défaut (gérée par CSS)
      return null;
    })
    .style('cursor', 'move')
    .style('opacity', isUpdate ? 0 : 1); // Invisible seulement si mise à jour
  
  // Animer l'apparition des nouvelles bulles avec effet élastique (seulement si mise à jour)
  if (isUpdate) {
    newBubbles
      .transition()
      .duration(800)
      .ease(d3.easeElasticOut)
      .attr('r', d => d.radius || 5)
      .style('opacity', 1);
  }
  
  // Mettre à jour les bulles existantes (update) - seulement si c'est une mise à jour
  if (isUpdate) {
    bubblesSelection
      .transition()
      .duration(800)
      .ease(d3.easeCubicOut)
      .attr('cx', d => d.x || width / 2)
      .attr('cy', d => d.y || height / 2)
      .attr('r', d => d.radius || 5) // Animer aussi le changement de taille si nécessaire
      .style('fill', d => {
        // Mettre à jour la couleur si le label change
        if (d.label) {
          return getLabelColor(d.label);
        }
        return null;
      });
  }
  
  // Fusionner les nouvelles et existantes pour les événements
  const allBubblesMerged = newBubbles.merge(bubblesSelection);
  
  // Continuer avec les événements sur toutes les bulles
  allBubblesMerged
    .call(drag)
    .on('contextmenu', function(event) {
      // Empêcher le menu contextuel par défaut
      event.preventDefault();
    })
    .on('click', function(event, d) {
      // Gérer les clics directement (en plus du drag.end)
      // Ne traiter que si ce n'était pas un drag
      if (!d.dragged) {
        event.stopPropagation();
        showAddressInfo(d);
        highlightConnections(d, links, allBubblesMerged, link);
      }
    })
    .on('mouseover', function(event, d) {
      d3.select(this).attr('stroke-width', 4);
      // Afficher les connexions au survol
      highlightConnections(d, links, allBubblesMerged, link);
      
      // Afficher le tooltip avec l'adresse et le label si disponible
      const tooltip = d3.select('#tooltip');
      
      // Construire le contenu du tooltip avec label
      const label = d.label || getAddressLabel(d.address);
      let tooltipContent = '';
      
      // Si c'est un groupe, afficher le label et le nombre d'adresses
      if (d.isGroup && d.label) {
        const addressCount = d.addresses ? d.addresses.length : 0;
        tooltipContent = `<strong>${d.label}</strong> <span style="color: #b0b0b0; font-weight: normal;">(Groupe: ${addressCount} adresse${addressCount > 1 ? 's' : ''})</span>`;
      } else {
        tooltipContent = `<strong>${d.address}</strong>`;
        if (label) {
          tooltipContent += ` <span style="color: #b0b0b0; font-weight: normal;">(${label})</span>`;
        }
      }
      
      tooltip
        .html(tooltipContent)
        .classed('hidden', false)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY - 10) + 'px');
    })
    .on('mousemove', function(event, d) {
      // Faire suivre le tooltip avec la souris
      const tooltip = d3.select('#tooltip');
      tooltip
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', function(event, d) {
      d3.select(this).attr('stroke-width', 2);
      // Réinitialiser l'affichage
      resetHighlight(allBubblesMerged, link);
      
      // Masquer le tooltip
      d3.select('#tooltip').classed('hidden', true);
    });
  
  // Ajouter des labels (adresses avec labels si disponibles)
  // Afficher les labels seulement pour les bulles avec un radius >= MIN_LABEL_RADIUS
  const labelNodes = nodes.filter(d => d.radius >= MIN_LABEL_RADIUS);
  const labelsSelection = svg.selectAll('.bubble-label')
    .data(labelNodes, d => d.id); // Utiliser l'ID comme clé
  
  // Supprimer les labels qui n'existent plus
  labelsSelection.exit()
    .transition()
    .duration(500)
    .ease(d3.easeCubicOut)
    .style('opacity', 0)
    .remove();
  
  // Créer les nouveaux labels
  const newLabels = labelsSelection.enter()
    .append('text')
    .attr('class', 'bubble-label')
    .attr('x', d => d.x)
    .attr('y', d => d.y)
    .text(d => {
      // Si c'est un groupe, afficher uniquement le label
      if (d.isGroup && d.label) {
        return d.label;
      }
      // Sinon, afficher l'adresse tronquée avec le label si disponible
      const addressShort = `${d.address.slice(0, 6)}...${d.address.slice(-4)}`;
      const label = d.label ? ` (${d.label})` : '';
      return addressShort + label;
    })
    .style('display', 'block')
    .style('pointer-events', 'none')
    .style('opacity', 0)
    .style('visibility', 'visible')
    .style('font-size', d => {
      // Taille de police proportionnelle au radius, avec un minimum de 8px et un maximum de 14px
      const fontSize = Math.max(8, Math.min(14, d.radius * 0.4));
      return `${fontSize}px`;
    });
  
  // Animer l'apparition des nouveaux labels
  newLabels
    .transition()
    .duration(600)
    .ease(d3.easeCubicOut)
    .style('opacity', 1);
  
  // Mettre à jour les labels existants
  labelsSelection
    .transition()
    .duration(600)
    .ease(d3.easeCubicOut)
    .text(d => {
      // Si c'est un groupe, afficher uniquement le label
      if (d.isGroup && d.label) {
        return d.label;
      }
      // Sinon, afficher l'adresse tronquée avec le label si disponible
      const addressShort = `${d.address.slice(0, 6)}...${d.address.slice(-4)}`;
      const label = d.label ? ` (${d.label})` : '';
      return addressShort + label;
    })
    .style('font-size', d => {
      // Taille de police proportionnelle au radius, avec un minimum de 8px et un maximum de 14px
      const fontSize = Math.max(8, Math.min(14, d.radius * 0.4));
      return `${fontSize}px`;
    });
  
  // Fusionner les nouveaux et existants
  const labels = newLabels.merge(labelsSelection);
  
  // Sauvegarder les références pour le filtre
  allBubbles = allBubblesMerged || bubblesSelection;
  allLinks = link;
  allNodes = nodes;
  allLinksData = links; // Sauvegarder les liens pour la recherche
  parentChildGraph = buildParentChildGraph(addressesData, addressToGroupMap); // Construire le graphe parent-enfant
  allLabels = labels;
  
  // Ajouter le handler de tick maintenant que allBubbles est défini
  simulation.on('tick', () => {
    // Ne pas mettre à jour les positions si on est en mode lecture automatique
    // (les bulles doivent rester en place pendant la lecture)
    if (timelinePlaying) {
      return;
    }
    
    // Confinement supplémentaire à chaque tick
    nodes.forEach(node => {
      const r = node.radius;
      node.x = Math.max(margin + r, Math.min(width - margin - r, node.x));
      node.y = Math.max(margin + r, Math.min(height - margin - r, node.y));
    });
    
    // Mettre à jour les liens (seulement s'ils existent)
    if (links.length > 0 && link) {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
    }
    
    // Mettre à jour les bulles
    if (allBubbles) {
      allBubbles
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);
    }
    
    // Mettre à jour les labels
    if (allLabels) {
      allLabels
        .attr('x', d => d.x)
        .attr('y', d => d.y);
    }
  });
  
  // Appliquer le filtre initial
  applyFilter();
  
  // Fonction pour mettre en évidence les connexions
  window.highlightConnections = function(node, links, bubbles, link) {
    const connectedNodeIds = new Set([node.id]);
    
    // Trouver tous les nœuds connectés (seulement s'il y a des liens)
    if (links && links.length > 0) {
      links.forEach(l => {
        const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
        const targetId = typeof l.target === 'object' ? l.target.id : l.target;
        
        if (sourceId === node.id) {
          connectedNodeIds.add(targetId);
        }
        if (targetId === node.id) {
          connectedNodeIds.add(sourceId);
        }
      });
    }
    
    // Mettre en évidence les bulles connectées
    bubbles
      .attr('opacity', d => connectedNodeIds.has(d.id) ? 1 : 0.2)
      .attr('stroke-width', d => {
        if (d.id === node.id) return 5;
        return connectedNodeIds.has(d.id) ? 4 : 1;
      });
    
    // Mettre en évidence les liens connectés (seulement s'il y en a)
    if (link && link.size && link.size() > 0) {
      link
        .attr('stroke-opacity', l => {
          const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
          const targetId = typeof l.target === 'object' ? l.target.id : l.target;
          return (sourceId === node.id || targetId === node.id) ? 0.8 : 0.1;
        })
        .attr('stroke-width', l => {
          const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
          const targetId = typeof l.target === 'object' ? l.target.id : l.target;
          return (sourceId === node.id || targetId === node.id) ? 3 : 1;
        })
        .attr('stroke', l => {
          const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
          const targetId = typeof l.target === 'object' ? l.target.id : l.target;
          return (sourceId === node.id || targetId === node.id) ? '#667eea' : '#999';
        });
    }
  };
  
  // Fonction pour réinitialiser la mise en évidence
  window.resetHighlight = function(bubbles, link) {
    bubbles.attr('opacity', 1).attr('stroke-width', 2);
    if (link && link.size && link.size() > 0) {
      link
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', d => Math.max(1, Math.min(3, Math.log10(d.value + 1) / 2)))
        .attr('stroke', '#999');
    }
  };
  
  // Fonction pour afficher les infos d'une adresse
  window.showAddressInfo = function(node) {
    selectedAddress = node;
    
    const balance = BigInt(node.balance);
    const inAmount = BigInt(node.in);
    const outAmount = BigInt(node.out);
    
    // Calculer le nombre d'adresses distinctes pour IN et OUT
    const allTransfers = node.transfers || [];
    const uniqueInAddresses = new Set();
    const uniqueOutAddresses = new Set();
    
    allTransfers.forEach(transfer => {
      if (transfer.type === 'in' && transfer.from) {
        uniqueInAddresses.add(transfer.from.toLowerCase());
      } else if (transfer.type === 'out' && transfer.to) {
        uniqueOutAddresses.add(transfer.to.toLowerCase());
      }
    });
    
    const countInAddresses = uniqueInAddresses.size;
    const countOutAddresses = uniqueOutAddresses.size;
    
    // Afficher l'adresse avec son label (utiliser innerHTML pour le style)
    const addressLabel = node.label || getAddressLabel(node.address);
    let addressHtml = '';
    
    // Si c'est un groupe, afficher toutes les adresses du groupe
    if (node.isGroup && node.addresses && node.addresses.length > 0) {
      addressHtml = `<div style="margin-bottom: 10px;"><strong style="color: #764ba2;">${addressLabel}</strong> <span style="color: #666; font-size: 0.9em;">(Groupe de ${node.addresses.length} adresse${node.addresses.length > 1 ? 's' : ''})</span></div>`;
      addressHtml += '<div style="max-height: 200px; overflow-y: auto; padding: 10px; background: #f9fafb; border-radius: 6px; margin-top: 10px;">';
      node.addresses.forEach(addr => {
        addressHtml += `<div style="margin-bottom: 5px; font-family: monospace; font-size: 0.85em;">${addr}</div>`;
      });
      addressHtml += '</div>';
    } else {
      addressHtml = `<span class="address">${node.address}</span>`;
      if (addressLabel) {
        addressHtml += ` <span style="color: #764ba2; font-weight: normal;">(${addressLabel})</span>`;
      }
    }
    
    document.getElementById('info-address').innerHTML = addressHtml;
    document.getElementById('info-in').textContent = formatAmount(node.in) + ' tokens';
    document.getElementById('info-out').textContent = formatAmount(node.out) + ' tokens';
    
    // Afficher le nombre d'adresses distinctes
    const inAddressesText = countInAddresses > 0 
      ? ` (${countInAddresses} adresse${countInAddresses > 1 ? 's' : ''})`
      : '';
    const outAddressesText = countOutAddresses > 0
      ? ` (${countOutAddresses} adresse${countOutAddresses > 1 ? 's' : ''})`
      : '';
    
    // Mettre à jour les éléments avec le nombre d'adresses
    const infoInElement = document.getElementById('info-in');
    const infoOutElement = document.getElementById('info-out');
    
    if (infoInElement) {
      infoInElement.textContent = formatAmount(node.in) + ' tokens' + inAddressesText;
    }
    if (infoOutElement) {
      infoOutElement.textContent = formatAmount(node.out) + ' tokens' + outAddressesText;
    }
    
    const balanceFormatted = formatAmount(balance < 0n ? (-balance).toString() : balance.toString());
    const balanceText = balance >= 0n ? `+${balanceFormatted}` : `-${balanceFormatted}`;
    document.getElementById('info-balance').textContent = balanceText + ' tokens';
    document.getElementById('info-balance').style.color = balance >= 0n ? '#10b981' : '#ef4444';
    
    // Afficher les connexions vers d'autres labels en suivant le flux réel (pour toutes les adresses)
    let labelConnectionsHtml = '';
    {
      // Créer un index de tous les transfers par txHash pour lier les transactions
      const transfersByTxHash = new Map();
      const addressToNodeMap = new Map();
      
      // Créer un map pour trouver rapidement un nœud par son adresse
      allNodes.forEach(n => {
        addressToNodeMap.set(n.address.toLowerCase(), n);
      });
      
      // Indexer tous les transfers de toutes les adresses
      allNodes.forEach(n => {
        if (n.transfers) {
          n.transfers.forEach(t => {
            const txHash = t.txHash;
            if (txHash) {
              if (!transfersByTxHash.has(txHash)) {
                transfersByTxHash.set(txHash, []);
              }
              transfersByTxHash.get(txHash).push({ ...t, address: n.address, nodeId: n.id });
            }
          });
        }
      });
      
      // Fonction pour suivre OUT : enfant → enfant → enfant jusqu'à trouver un label
      // IMPORTANT: Un enfant ne peut pas dépenser plus que ce qu'il a reçu du parent
      // On limite le montant au montant reçu à chaque étape
      function traceOutFlow(outTransfer, availableAmount, visitedTxHashes = new Set()) {
        const results = [];
        const txHash = outTransfer.txHash;
        const toAddress = outTransfer.to?.toLowerCase();
        const blockNumber = outTransfer.blockNumber || 0;
        const transferAmount = BigInt(outTransfer.amount || '0');
        
        // Le montant disponible ne peut pas dépasser le montant du transfer
        // Si l'enfant envoie plus que ce qu'il a reçu, on limite au montant reçu
        const amountToFollow = transferAmount < availableAmount ? transferAmount : availableAmount;
        
        if (!toAddress || visitedTxHashes.has(txHash) || amountToFollow === 0n) return results;
        visitedTxHashes.add(txHash);
        
        // Trouver le receveur dans la même transaction et le montant qu'il a reçu
        const sameTxTransfers = transfersByTxHash.get(txHash) || [];
        const inTransfers = sameTxTransfers.filter(t => t.type === 'in' && t.address.toLowerCase() === toAddress);
        
        for (const inTransfer of inTransfers) {
          const receiverAddress = inTransfer.address.toLowerCase();
          const receiverLabel = getAddressLabel(receiverAddress);
          const receivedAmount = BigInt(inTransfer.amount || '0');
          
          // Le montant que l'enfant a réellement reçu (peut être différent du montant envoyé)
          const actualReceivedAmount = receivedAmount < amountToFollow ? receivedAmount : amountToFollow;
          
          if (receiverLabel) {
            // On a trouvé un label, on s'arrête ici avec le montant réellement reçu
            results.push({
              label: receiverLabel,
              amount: actualReceivedAmount,
              txHash: txHash
            });
          } else {
            // Pas de label, suivre les OUT de ce receveur après ce blockNumber
            // MAIS seulement avec le montant qu'il a réellement reçu
            const receiverNode = addressToNodeMap.get(receiverAddress);
            if (receiverNode && receiverNode.transfers) {
              // Prendre les transfers OUT de l'enfant après le blockNumber du transfer actuel
              const nextOutTransfers = receiverNode.transfers
                .filter(t => t.type === 'out' && 
                             BigInt(t.amount || '0') > 0n &&
                             (t.blockNumber || 0) >= blockNumber)
                .sort((a, b) => (a.blockNumber || 0) - (b.blockNumber || 0));
              
              for (const nextOut of nextOutTransfers) {
                // Limiter le montant au montant réellement reçu par l'enfant
                const subResults = traceOutFlow(nextOut, actualReceivedAmount, new Set(visitedTxHashes));
                subResults.forEach(r => {
                  // Éviter les doublons par txHash
                  const existing = results.find(ex => ex.label === r.label && ex.txHash === r.txHash);
                  if (!existing) {
                    results.push(r);
                  } else {
                    // Si on a déjà ce label avec ce txHash, prendre le montant maximum
                    if (r.amount > existing.amount) {
                      existing.amount = r.amount;
                    }
                  }
                });
              }
            }
          }
        }
        
        return results;
      }
      
      // Fonction pour suivre IN : parent ← parent ← parent jusqu'à trouver un label
      // On remonte chronologiquement : prendre le blockNumber du IN, puis suivre les IN du parent avant ce blockNumber
      function traceInFlow(inTransfer, originalAmount, visitedTxHashes = new Set()) {
        const results = [];
        const txHash = inTransfer.txHash;
        const fromAddress = inTransfer.from?.toLowerCase();
        const blockNumber = inTransfer.blockNumber || 0;
        
        if (!fromAddress || visitedTxHashes.has(txHash)) return results;
        visitedTxHashes.add(txHash);
        
        // Trouver le sender dans la même transaction
        const sameTxTransfers = transfersByTxHash.get(txHash) || [];
        const outTransfers = sameTxTransfers.filter(t => t.type === 'out' && t.address.toLowerCase() === fromAddress);
        
        for (const outTransfer of outTransfers) {
          const senderAddress = outTransfer.address.toLowerCase();
          const senderLabel = getAddressLabel(senderAddress);
          
          if (senderLabel) {
            // On a trouvé un label, on s'arrête ici
            results.push({
              label: senderLabel,
              amount: originalAmount,
              txHash: txHash
            });
          } else {
            // Pas de label, remonter les IN de ce sender avant ce blockNumber
            const senderNode = addressToNodeMap.get(senderAddress);
            if (senderNode && senderNode.transfers) {
              // Prendre les transfers IN du parent avant le blockNumber du transfer actuel
              const prevInTransfers = senderNode.transfers
                .filter(t => t.type === 'in' && 
                             BigInt(t.amount || '0') > 0n &&
                             (t.blockNumber || 0) <= blockNumber)
                .sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0)); // Plus récent d'abord
              
              for (const prevIn of prevInTransfers) {
                const subResults = traceInFlow(prevIn, originalAmount, new Set(visitedTxHashes));
                subResults.forEach(r => {
                  // Éviter les doublons par txHash
                  const existing = results.find(ex => ex.label === r.label && ex.txHash === r.txHash);
                  if (!existing) {
                    results.push(r);
                  }
                });
              }
            }
          }
        }
        
        return results;
      }
      
      // Collecter tous les OUT vers des labels
      // IMPORTANT: Chaque transfer OUT est suivi individuellement avec son montant exact
      // On ne peut pas dépenser plus que ce qui a été reçu
      const outLabelTransfersMap = new Map(); // Clé: label + txHash original + path, Valeur: montant
      allTransfers
        .filter(t => t.type === 'out' && BigInt(t.amount || '0') > 0n)
        .forEach(outTransfer => {
          const originalAmount = BigInt(outTransfer.amount || '0');
          const originalTxHash = outTransfer.txHash;
          // Suivre ce transfer avec son montant exact
          const results = traceOutFlow(outTransfer, originalAmount);
          results.forEach(r => {
            // Utiliser label + txHash original + path comme clé pour éviter les doublons
            // Mais on additionne les montants si c'est le même label mais des chemins différents
            const key = `${r.label}|${originalTxHash}`;
            if (!outLabelTransfersMap.has(key)) {
              outLabelTransfersMap.set(key, {
                label: r.label,
                amount: r.amount,
                txHash: originalTxHash
              });
            } else {
              // Si même label et même txHash, prendre le montant maximum (c'est le même transfer)
              const existing = outLabelTransfersMap.get(key);
              if (r.amount > existing.amount) {
                existing.amount = r.amount;
              }
            }
          });
        });
      
      // Maintenant, regrouper par label uniquement (sans txHash) pour l'affichage final
      // Mais s'assurer que la somme ne dépasse pas le total OUT
      const outByLabelFinal = new Map();
      outLabelTransfersMap.forEach((value, key) => {
        const label = value.label;
        const amount = value.amount;
        if (!outByLabelFinal.has(label)) {
          outByLabelFinal.set(label, 0n);
        }
        outByLabelFinal.set(label, outByLabelFinal.get(label) + amount);
      });
      
      // Limiter la somme totale au total OUT réel
      const totalOutReal = BigInt(node.out || '0');
      let totalOutLabels = 0n;
      outByLabelFinal.forEach(amount => {
        totalOutLabels += amount;
      });
      
      // Si la somme dépasse le total OUT, réduire proportionnellement
      if (totalOutLabels > totalOutReal && totalOutLabels > 0n) {
        const ratio = Number(totalOutReal) / Number(totalOutLabels);
        outByLabelFinal.forEach((amount, label) => {
          const adjustedAmount = BigInt(Math.floor(Number(amount) * ratio));
          outByLabelFinal.set(label, adjustedAmount);
        });
      }
      
      // Collecter tous les IN depuis des labels (avec déduplication par txHash)
      const inLabelTransfersMap = new Map(); // Clé: label + txHash, Valeur: montant
      allTransfers
        .filter(t => t.type === 'in' && BigInt(t.amount || '0') > 0n)
        .forEach(inTransfer => {
          const originalAmount = BigInt(inTransfer.amount || '0');
          const originalTxHash = inTransfer.txHash;
          const results = traceInFlow(inTransfer, originalAmount);
          results.forEach(r => {
            // Utiliser label + txHash comme clé pour éviter de compter plusieurs fois le même transfer
            const key = `${r.label}|${originalTxHash}`;
            if (!inLabelTransfersMap.has(key)) {
              inLabelTransfersMap.set(key, {
                label: r.label,
                amount: r.amount,
                txHash: originalTxHash
              });
            } else {
              // Si même label et même txHash, prendre le montant maximum (c'est le même transfer)
              const existing = inLabelTransfersMap.get(key);
              if (r.amount > existing.amount) {
                existing.amount = r.amount;
              }
            }
          });
        });
      
      // Regrouper par label uniquement (sans txHash) pour l'affichage final
      const inByLabelFinal = new Map();
      inLabelTransfersMap.forEach((value, key) => {
        const label = value.label;
        const amount = value.amount;
        if (!inByLabelFinal.has(label)) {
          inByLabelFinal.set(label, 0n);
        }
        inByLabelFinal.set(label, inByLabelFinal.get(label) + amount);
      });
      
      // Limiter la somme totale au total IN réel
      const totalInReal = BigInt(node.in || '0');
      let totalInLabels = 0n;
      inByLabelFinal.forEach(amount => {
        totalInLabels += amount;
      });
      
      // Si la somme dépasse le total IN, réduire proportionnellement
      if (totalInLabels > totalInReal && totalInLabels > 0n) {
        const ratio = Number(totalInReal) / Number(totalInLabels);
        inByLabelFinal.forEach((amount, label) => {
          const adjustedAmount = BigInt(Math.floor(Number(amount) * ratio));
          inByLabelFinal.set(label, adjustedAmount);
        });
      }
      
      // Convertir inByLabelFinal en format pour l'affichage
      const inByLabel = new Map();
      inByLabelFinal.forEach((amount, label) => {
        inByLabel.set(label, { label: label, total: amount });
      });
      
      // Convertir outByLabelFinal en format pour l'affichage
      const outByLabel = new Map();
      outByLabelFinal.forEach((amount, label) => {
        outByLabel.set(label, { label: label, total: amount });
      });
      
      // Construire le HTML pour les connexions vers les labels (simplifié)
      if (inByLabel.size > 0 || outByLabel.size > 0) {
        labelConnectionsHtml = '<div class="label-connections" style="margin-top: 20px; padding-top: 20px; border-top: 2px solid #e5e7eb;">';
        labelConnectionsHtml += '<h3 style="margin-bottom: 15px; color: #764ba2;">Connexions vers d\'autres labels</h3>';
        
        if (inByLabel.size > 0) {
          labelConnectionsHtml += '<div style="margin-bottom: 15px;">';
          labelConnectionsHtml += '<h4 style="color: #10b981; margin-bottom: 10px;">⬇️ IN depuis des labels:</h4>';
          Array.from(inByLabel.values())
            .sort((a, b) => b.total > a.total ? 1 : -1)
            .forEach(entry => {
              const labelColor = getLabelColor(entry.label);
              labelConnectionsHtml += `
                <div style="margin-bottom: 8px; padding: 8px; background: #f9fafb; border-radius: 6px; border-left: 4px solid ${labelColor};">
                  <strong style="color: ${labelColor};">${entry.label}</strong>
                  <span style="font-size: 0.9em; color: #666; margin-left: 10px;">${formatAmount(entry.total.toString())} tokens</span>
                </div>
              `;
            });
          labelConnectionsHtml += '</div>';
        }
        
        if (outByLabel.size > 0) {
          labelConnectionsHtml += '<div style="margin-bottom: 15px;">';
          labelConnectionsHtml += '<h4 style="color: #ef4444; margin-bottom: 10px;">⬆️ OUT vers des labels:</h4>';
          Array.from(outByLabel.values())
            .sort((a, b) => b.total > a.total ? 1 : -1)
            .forEach(entry => {
              const labelColor = getLabelColor(entry.label);
              labelConnectionsHtml += `
                <div style="margin-bottom: 8px; padding: 8px; background: #f9fafb; border-radius: 6px; border-left: 4px solid ${labelColor};">
                  <strong style="color: ${labelColor};">${entry.label}</strong>
                  <span style="font-size: 0.9em; color: #666; margin-left: 10px;">${formatAmount(entry.total.toString())} tokens</span>
                </div>
              `;
            });
          labelConnectionsHtml += '</div>';
        }
        
        labelConnectionsHtml += '</div>';
      }
    }
    
    // Stocker labelConnectionsHtml pour l'afficher après les transfers
    const labelConnectionsHtmlToShow = labelConnectionsHtml;
    
    // Afficher tous les transfers avec pagination
    const allTransfersList = (node.transfers || [])
      .sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0)); // Plus récent d'abord
    
    // Variables de pagination
    const transfersPerPage = 5;
    let currentPage = 1;
    const totalPages = Math.ceil(allTransfersList.length / transfersPerPage);
    
    // Fonction pour afficher une page de transfers
    function displayTransfersPage(page) {
      const startIndex = (page - 1) * transfersPerPage;
      const endIndex = startIndex + transfersPerPage;
      const pageTransfers = allTransfersList.slice(startIndex, endIndex);
      
      const transfersHtml = pageTransfers.length > 0
        ? pageTransfers.map(t => {
            const otherAddress = t.type === 'in' ? t.from : t.to;
            const otherLabel = otherAddress ? getAddressLabel(otherAddress) : null;
            const otherAddressFormatted = formatAddress(otherAddress);
            const otherAddressWithLabel = otherLabel 
              ? `${otherAddressFormatted} <span style="color: #764ba2;">(${otherLabel})</span>`
              : otherAddressFormatted;
            
            return `
            <div class="transfer-item ${t.type}">
              <strong>${t.type === 'in' ? '⬇️ IN' : '⬆️ OUT'}</strong>
              ${t.type === 'in' ? `De: ${otherAddressWithLabel}` : `Vers: ${otherAddressWithLabel}`}<br>
              Montant: ${formatAmount(t.amount)} tokens<br>
              Block: ${t.blockNumber}${t.txHash ? ` | Tx: ${t.txHash.slice(0, 10)}...` : ''}
            </div>
          `;
          }).join('')
        : '<p>Aucun transfer enregistré</p>';
      
      document.getElementById('info-transfers').innerHTML = transfersHtml + labelConnectionsHtmlToShow;
      
      // Mettre à jour la pagination
      const paginationDiv = document.getElementById('transfers-pagination');
      const pageInfo = document.getElementById('page-info');
      const prevBtn = document.getElementById('prev-page');
      const nextBtn = document.getElementById('next-page');
      
      if (allTransfersList.length > transfersPerPage) {
        paginationDiv.style.display = 'block';
        pageInfo.textContent = `Page ${page} sur ${totalPages} (${allTransfersList.length} transfers au total)`;
        prevBtn.disabled = page === 1;
        prevBtn.style.opacity = page === 1 ? '0.5' : '1';
        prevBtn.style.cursor = page === 1 ? 'not-allowed' : 'pointer';
        nextBtn.disabled = page === totalPages;
        nextBtn.style.opacity = page === totalPages ? '0.5' : '1';
        nextBtn.style.cursor = page === totalPages ? 'not-allowed' : 'pointer';
      } else {
        paginationDiv.style.display = 'none';
      }
    }
    
    // Gestionnaires d'événements pour la pagination
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    
    // Supprimer les anciens listeners s'ils existent
    const newPrevBtn = prevBtn.cloneNode(true);
    const newNextBtn = nextBtn.cloneNode(true);
    prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
    nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
    
    newPrevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        displayTransfersPage(currentPage);
      }
    });
    
    newNextBtn.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++;
        displayTransfersPage(currentPage);
      }
    });
    
    // Afficher la première page
    displayTransfersPage(1);
    document.getElementById('info-panel').classList.remove('hidden');
  };
}

// Fermer le panneau d'info
document.getElementById('close-info').addEventListener('click', () => {
  document.getElementById('info-panel').classList.add('hidden');
  selectedAddress = null;
});

// Fermer en cliquant en dehors
document.getElementById('info-panel').addEventListener('click', (e) => {
  if (e.target.id === 'info-panel') {
    document.getElementById('info-panel').classList.add('hidden');
    selectedAddress = null;
  }
});

// Construire un graphe directionnel parent -> enfant à partir des transfers
function buildParentChildGraph(addressesData, addressToGroupMap = null) {
  const graph = new Map(); // Map<nodeId, Set<childNodeId>>
  const useGrouping = addressToGroupMap !== null;
  
  // Créer un index des groupes/adresses pour mapper vers les indices dans groupedAddressesData
  const groupIndexMap = new Map();
  if (useGrouping && groupedAddressesData) {
    groupedAddressesData.forEach((addr, i) => {
      const key = addr.isGroup ? addr.label : addr.address.toLowerCase();
      groupIndexMap.set(key, i);
    });
  }
  
  addressesData.forEach((addr, sourceIndex) => {
    const sourceKey = useGrouping && addressToGroupMap
      ? (addressToGroupMap.get(addr.address.toLowerCase()) || addr.address.toLowerCase())
      : addr.address.toLowerCase();
    
    const sourceGroupIndex = useGrouping && groupIndexMap.has(sourceKey)
      ? groupIndexMap.get(sourceKey)
      : sourceIndex;
    
    const children = new Set();
    
    // Parcourir uniquement les transfers "out" (sortants)
    // Un transfer "out" signifie que cette adresse a envoyé des tokens à une autre
    (addr.transfers || []).forEach(transfer => {
      if (transfer.type === 'out' && transfer.to) {
        const targetAddress = transfer.to.toLowerCase();
        
        // Mapper l'adresse cible vers son groupe si on utilise le regroupement
        const targetKey = useGrouping && addressToGroupMap
          ? (addressToGroupMap.get(targetAddress) || targetAddress)
          : targetAddress;
        
        // Trouver l'index de la cible dans les données regroupées
        let targetIndex = -1;
        if (useGrouping && groupIndexMap.has(targetKey)) {
          targetIndex = groupIndexMap.get(targetKey);
        } else if (!useGrouping) {
          targetIndex = addressesData.findIndex(a => 
            a.address.toLowerCase() === targetAddress
          );
        }
        
        if (targetIndex !== -1 && targetIndex !== sourceGroupIndex) {
          children.add(targetIndex);
        }
      }
    });
    
    if (children.size > 0) {
      graph.set(sourceGroupIndex, children);
    }
  });
  
  console.log(`🌳 Graphe parent-enfant créé: ${graph.size} parents avec enfants`);
  return graph;
}

// Fonction pour trouver tous les enfants récursifs d'un nœud (parent) avec limite de profondeur
function findAllChildrenNodes(nodeId, parentChildGraph, nodes, maxDepth = 10) {
  console.log('🔍 findAllChildrenNodes - nodeId:', nodeId, 'maxDepth:', maxDepth);
  
  const children = new Set([nodeId]); // Inclure le parent lui-même
  // Queue contient [nodeId, depth]
  const queue = [[nodeId, 0]];
  const visited = new Set([nodeId]);
  
  while (queue.length > 0) {
    const [currentId, currentDepth] = queue.shift();
    
    // Si on a atteint la profondeur maximale, ne pas continuer
    if (currentDepth >= maxDepth) {
      continue;
    }
    
    // Trouver tous les enfants directs de currentId
    const directChildren = parentChildGraph.get(currentId);
    if (directChildren) {
      directChildren.forEach(childId => {
        if (!visited.has(childId)) {
          visited.add(childId);
          children.add(childId);
          // Ajouter avec la profondeur suivante
          queue.push([childId, currentDepth + 1]);
        }
      });
    }
  }
  
  console.log(`✅ Enfants trouvés (profondeur max ${maxDepth}):`, children.size, 'nœuds');
  return children;
}

// Fonction pour appliquer le filtre de recherche
function applySearchFilter(searchAddress) {
  console.log('🔍 Recherche de:', searchAddress);
  console.log('📊 allNodes:', allNodes ? allNodes.length : 'non défini');
  console.log('📊 allLinksData:', allLinksData ? allLinksData.length : 'non défini');
  
  if (!searchAddress) {
    searchFilterActive = false;
    searchConnectedNodes.clear();
    updateVisualization();
    return;
  }
  
  if (!allNodes || allNodes.length === 0) {
    console.error('❌ allNodes non initialisé ou vide');
    alert('Les données ne sont pas encore chargées. Veuillez patienter...');
    return;
  }
  
  // Normaliser l'adresse de recherche
  const normalizedSearch = searchAddress.toLowerCase().trim();
  
  // Trouver le nœud correspondant (recherche exacte d'abord, puis partielle)
  let foundNode = allNodes.find(n => n.address.toLowerCase() === normalizedSearch);
  
  // Si pas trouvé, essayer une recherche partielle
  if (!foundNode) {
    foundNode = allNodes.find(n => {
      const nodeAddr = n.address.toLowerCase();
      return nodeAddr.startsWith(normalizedSearch) || nodeAddr.endsWith(normalizedSearch);
    });
  }
  
  if (!foundNode) {
    console.log('❌ Adresse non trouvée:', searchAddress);
    console.log('📋 Exemples d\'adresses disponibles:', allNodes.slice(0, 5).map(n => n.address));
    alert(`Adresse "${searchAddress}" non trouvée dans les données.\n\nEssayez une adresse complète ou les premiers/derniers caractères.`);
    searchFilterActive = false;
    searchConnectedNodes.clear();
    updateVisualization();
    return;
  }
  
  console.log('✅ Adresse trouvée:', foundNode.address, 'ID:', foundNode.id);
  
  // Trouver tous les enfants récursifs avec la profondeur choisie
  if (parentChildGraph) {
    searchConnectedNodes = findAllChildrenNodes(foundNode.id, parentChildGraph, allNodes, searchDepth);
    searchFilterActive = true;
    console.log(`🌳 ${searchConnectedNodes.size} enfants trouvés (profondeur: ${searchDepth})`);
  } else {
    // Si pas de graphe, afficher seulement le nœud trouvé
    searchConnectedNodes = new Set([foundNode.id]);
    searchFilterActive = true;
    console.log('⚠️ Aucun graphe parent-enfant disponible, affichage du nœud seul');
  }
  
  updateVisualization();
}

// Fonction pour recalculer les tailles des bulles visibles après filtrage
function recalculateVisibleBubbleSizes() {
  if (!allBubbles || !allNodes) return;
  
  // Collecter toutes les bulles visibles et leurs balances
  // Toujours vérifier l'état actuel (opacity, visibility) plutôt que shouldShowWithoutSizeFilter
  // car cette fonction peut être appelée après l'application du filtre de taille
  const visibleBubbles = [];
  allBubbles.each(function(d) {
    const bubble = d3.select(this);
    // Vérifier l'état actuel de la bulle (après tous les filtres)
    const isVisible = bubble.style('opacity') !== '0' && 
                      bubble.style('visibility') !== 'hidden' &&
                      !bubble.classed('filtered-out');
    
    if (isVisible) {
      const balance = BigInt(d.balance);
      const absBalance = balance < 0n ? -balance : balance;
      visibleBubbles.push({
        node: d,
        absBalance: Number(absBalance)
      });
    }
  });
  
  if (visibleBubbles.length === 0) return;
  
  // Trouver le min et max des balances visibles
  const visibleMinBalance = d3.min(visibleBubbles, d => d.absBalance);
  const visibleMaxBalance = d3.max(visibleBubbles, d => d.absBalance);
  
  // Si toutes les balances sont identiques, ne pas redimensionner
  if (visibleMinBalance === visibleMaxBalance) return;
  
  console.log(`📏 Recalcul des tailles: ${visibleBubbles.length} bulles visibles`);
  console.log(`   Balance range visible: ${visibleMinBalance} - ${visibleMaxBalance}`);
  
  // Recalculer la taille max basée sur l'écran
  const headerHeight = document.querySelector('header').offsetHeight;
  const width = window.innerWidth;
  const height = window.innerHeight - headerHeight;
  const screenSize = Math.min(width, height);
  
  // Calculer le nombre total de bulles et le ratio de bulles visibles
  const totalBubbles = allNodes ? allNodes.length : visibleBubbles.length;
  const visibleRatio = visibleBubbles.length / totalBubbles;
  
  // Augmenter le maxRadius utilisé pour le recalcul en fonction du nombre de bulles retirées
  // Plus on retire de bulles, plus on agrandit les bulles restantes
  // Facteur d'agrandissement : si on retire 50% des bulles, on peut utiliser 1.5x l'espace
  // Si on retire 80% des bulles, on peut utiliser 2x l'espace
  const expansionFactor = Math.max(1, 1 + (1 - visibleRatio) * 1.5); // Entre 1x et 2.5x
  const baseMaxRadius = screenSize / 10;
  const currentMaxRadius = baseMaxRadius * expansionFactor;
  const currentMinRadius = 2;
  
  console.log(`   Expansion factor: ${expansionFactor.toFixed(2)}x (${(visibleRatio * 100).toFixed(1)}% bulles visibles)`);
  console.log(`   Max radius ajusté: ${currentMaxRadius.toFixed(1)}px (base: ${baseMaxRadius.toFixed(1)}px)`);
  
  // Recalculer les tailles pour chaque bulle visible
  visibleBubbles.forEach(({ node, absBalance }) => {
    // Vérifier si le nœud a un label
    const hasLabel = node.label || getAddressLabel(node.address);
    
    // Calculer le radius proportionnellement aux balances visibles
    const proportion = (absBalance - visibleMinBalance) / (visibleMaxBalance - visibleMinBalance);
    const newRadius = currentMinRadius + (proportion * (currentMaxRadius - currentMinRadius));
    
    // S'assurer que le radius est dans les limites
    let finalRadius = Math.max(currentMinRadius, Math.min(currentMaxRadius, newRadius));
    
    // Si la bulle a un label, s'assurer qu'elle a au moins MIN_LABEL_RADIUS
    if (hasLabel && finalRadius < MIN_LABEL_RADIUS) {
      finalRadius = MIN_LABEL_RADIUS;
    }
    
    // Mettre à jour le radius du nœud
    node.radius = finalRadius;
    
    // Mettre à jour maxRadius global si nécessaire (pour le filtre de taille)
    if (finalRadius > maxRadius) {
      maxRadius = finalRadius;
    }
    
    // Appliquer la nouvelle taille avec transition
    const bubble = allBubbles.filter(d => d.id === node.id);
    if (bubble.size() > 0) {
      bubble
        .transition()
        .duration(300)
        .ease(d3.easeCubicOut)
        .attr('r', finalRadius);
    }
  });
  
  // Mettre à jour les labels si nécessaire
  if (allLabels) {
    allLabels.each(function(d) {
      const label = d3.select(this);
      const node = allNodes.find(n => n.id === d.id);
      
      if (node) {
        // Afficher le label seulement si le radius est >= MIN_LABEL_RADIUS
        if (node.radius >= MIN_LABEL_RADIUS) {
          label
            .style('display', 'block')
            .style('font-size', () => {
              // Taille de police proportionnelle au radius, avec un minimum de 8px et un maximum de 14px
              const fontSize = Math.max(8, Math.min(14, node.radius * 0.4));
              return `${fontSize}px`;
            });
        } else {
          label.style('display', 'none');
        }
      }
    });
  }
  
  // Ajouter les labels pour les nouvelles bulles qui sont maintenant assez grandes
  if (allBubbles && allNodes) {
    const svg = d3.select('#bubble-map');
    const existingLabelIds = new Set();
    allLabels.each(function(d) {
      existingLabelIds.add(d.id);
    });
    
    // Trouver les nœuds qui devraient avoir un label mais n'en ont pas
    const nodesNeedingLabels = allNodes.filter(n => 
      n.radius >= MIN_LABEL_RADIUS && !existingLabelIds.has(n.id)
    );
    
    if (nodesNeedingLabels.length > 0) {
      const newLabelsSelection = svg.selectAll('.bubble-label')
        .data(nodesNeedingLabels, d => d.id);
      
      const newLabels = newLabelsSelection.enter()
        .append('text')
        .attr('class', 'bubble-label')
        .attr('x', d => d.x || 0)
        .attr('y', d => d.y || 0)
        .text(d => {
          const addressShort = `${d.address.slice(0, 6)}...${d.address.slice(-4)}`;
          const label = d.label ? ` (${d.label})` : '';
          return addressShort + label;
        })
        .style('display', 'block')
        .style('pointer-events', 'none')
        .style('opacity', 0)
        .style('visibility', 'visible')
        .style('font-size', d => {
          const fontSize = Math.max(8, Math.min(14, d.radius * 0.4));
          return `${fontSize}px`;
        });
      
      newLabels
        .transition()
        .duration(300)
        .ease(d3.easeCubicOut)
        .style('opacity', 1);
      
      // Mettre à jour allLabels avec les nouveaux labels
      allLabels = newLabels.merge(allLabels);
    }
  }
  
  // Mettre à jour la force de collision avec les nouveaux radius et relancer la simulation
  if (simulation) {
    // Mettre à jour la force de collision avec les nouveaux radius
    simulation.force('collision', d3.forceCollide().radius(d => {
      // Utiliser le radius mis à jour du nœud
      return (d.radius || minRadius) + 1;
    }));
    
    // Relancer la simulation pour réorganiser les bulles et les liens
    // Utiliser une valeur alpha plus élevée pour une réorganisation plus visible
    simulation.alpha(0.5).restart();
  }
}

// Fonction pour mettre à jour la visualisation selon les filtres
function updateVisualization() {
  console.log('🔄 updateVisualization appelée');
  console.log('  - searchFilterActive:', searchFilterActive);
  console.log('  - searchConnectedNodes.size:', searchConnectedNodes.size);
  console.log('  - allBubbles:', allBubbles ? 'défini' : 'non défini');
  console.log('  - allLinks:', allLinks ? 'défini' : 'non défini');
  console.log('  - allLabels:', allLabels ? 'défini' : 'non défini');
  
  if (!allBubbles) {
    console.error('❌ allBubbles non défini');
    return;
  }
  
  let visibleCount = 0;
  let hiddenCount = 0;
  
  // Étape 1: Appliquer tous les filtres SAUF le filtre de taille
  allBubbles.each(function(d) {
    const bubble = d3.select(this);
    let shouldShow = true;
    
    // Filtre de recherche
    if (searchFilterActive) {
      const isConnected = searchConnectedNodes.has(d.id);
      shouldShow = isConnected;
      if (!isConnected) {
        hiddenCount++;
      } else {
        visibleCount++;
      }
    } else {
      visibleCount++;
    }
    
    // Filtre "Labels only" - afficher uniquement les nœuds avec des labels
    if (shouldShow && labelsOnlyFilterActive) {
      const label = d.label || getAddressLabel(d.address);
      if (!label) {
        shouldShow = false;
        hiddenCount++;
        visibleCount--;
      }
    }
    
    // Filtre "PAD only" - afficher uniquement les nœuds avec des labels "PAD -"
    if (shouldShow && padOnlyFilterActive) {
      const label = d.label || getAddressLabel(d.address);
      if (!label || !label.startsWith('PAD -')) {
        shouldShow = false;
        hiddenCount++;
        visibleCount--;
      }
    }
    
    // Filtre des balances à 0 (seulement si la recherche n'est pas active)
    // Pendant la recherche, on veut voir toutes les connexions même avec balance à 0
    if (shouldShow && hideOutBubbles && !searchFilterActive && !labelsOnlyFilterActive && !padOnlyFilterActive) {
      const balance = BigInt(d.balance);
      if (balance === 0n) {
        shouldShow = false;
        hiddenCount++;
        visibleCount--;
      }
    }
    
    // Stocker temporairement si la bulle devrait être visible (sans le filtre de taille)
    bubble.datum().shouldShowWithoutSizeFilter = shouldShow;
  });
  
  // Étape 2: Recalculer les tailles des bulles visibles (sans le filtre de taille)
  // Cela permet d'avoir les bonnes tailles pour appliquer le filtre de taille
  recalculateVisibleBubbleSizes();
  
  // Étape 3: Calculer le min et max des radius actuels pour le filtre de taille
  const currentRadii = [];
  allBubbles.each(function(d) {
    if (d.shouldShowWithoutSizeFilter) {
      currentRadii.push(d.radius || minRadius);
    }
  });
  
  const currentMinRadiusForFilter = currentRadii.length > 0 ? d3.min(currentRadii) : minRadius;
  const currentMaxRadiusForFilter = currentRadii.length > 0 ? d3.max(currentRadii) : maxRadius;
  
  // Étape 4: Appliquer le filtre de taille et mettre à jour l'affichage
  allBubbles.each(function(d) {
    const bubble = d3.select(this);
    let shouldShow = d.shouldShowWithoutSizeFilter || false;
    
    // Filtre par taille de bulle (basé sur le radius recalculé)
    if (shouldShow) {
      const radius = d.radius || minRadius;
      // Convertir le radius en pourcentage (0-100) par rapport aux radius actuels des bulles visibles
      const radiusPercent = currentMaxRadiusForFilter > currentMinRadiusForFilter 
        ? ((radius - currentMinRadiusForFilter) / (currentMaxRadiusForFilter - currentMinRadiusForFilter)) * 100
        : 100;
      
      // Vérifier si le radius est dans la plage sélectionnée
      if (radiusPercent < sizeFilterMin || radiusPercent > sizeFilterMax) {
        shouldShow = false;
        hiddenCount++;
        visibleCount--;
      }
    }
    
    // Appliquer le style
    if (shouldShow) {
      bubble
        .style('opacity', 1)
        .style('pointer-events', 'all')
        .style('visibility', 'visible')
        .classed('filtered-out', false);
    } else {
      bubble
        .style('opacity', 0)
        .style('pointer-events', 'none')
        .style('visibility', 'hidden')
        .classed('filtered-out', true);
    }
  });
  
  console.log(`  ✅ ${visibleCount} bulles visibles, ${hiddenCount} bulles masquées`);
  
  // Recalculer les tailles des bulles visibles APRÈS avoir appliqué le filtre de taille
  // Cela permet d'agrandir les bulles restantes pour mieux utiliser l'espace
  recalculateVisibleBubbleSizes();
  
  // Filtrer les liens
  if (allLinks) {
    let linkVisibleCount = 0;
    let linkHiddenCount = 0;
    
    allLinks.style('display', (l) => {
      let shouldShow = true;
      
      if (searchFilterActive) {
        const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
        const targetId = typeof l.target === 'object' ? l.target.id : l.target;
        if (!searchConnectedNodes.has(sourceId) || !searchConnectedNodes.has(targetId)) {
          shouldShow = false;
        }
      }
      
      // Filtre "Labels only" - afficher uniquement les liens entre nœuds avec labels
      if (shouldShow && labelsOnlyFilterActive) {
        const source = typeof l.source === 'object' ? l.source : allNodes[l.source];
        const target = typeof l.target === 'object' ? l.target : allNodes[l.target];
        if (source && target) {
          const sourceLabel = source.label || getAddressLabel(source.address);
          const targetLabel = target.label || getAddressLabel(target.address);
          if (!sourceLabel || !targetLabel) {
            shouldShow = false;
          }
        }
      }
      
      // Filtre "PAD only" - afficher uniquement les liens entre nœuds avec labels "PAD -"
      if (shouldShow && padOnlyFilterActive) {
        const source = typeof l.source === 'object' ? l.source : allNodes[l.source];
        const target = typeof l.target === 'object' ? l.target : allNodes[l.target];
        if (source && target) {
          const sourceLabel = source.label || getAddressLabel(source.address);
          const targetLabel = target.label || getAddressLabel(target.address);
          if (!sourceLabel || !sourceLabel.startsWith('PAD -') || !targetLabel || !targetLabel.startsWith('PAD -')) {
            shouldShow = false;
          }
        }
      }
      
      if (shouldShow && hideOutBubbles && !searchFilterActive && !labelsOnlyFilterActive && !padOnlyFilterActive) {
        const source = typeof l.source === 'object' ? l.source : allNodes[l.source];
        const target = typeof l.target === 'object' ? l.target : allNodes[l.target];
        if (source && target) {
          const sourceBalance = BigInt(source.balance);
          const targetBalance = BigInt(target.balance);
          if (sourceBalance === 0n || targetBalance === 0n) {
            shouldShow = false;
          }
        }
      }
      
      // Filtre par taille de bulle pour les liens
      if (shouldShow) {
        const source = typeof l.source === 'object' ? l.source : allNodes[l.source];
        const target = typeof l.target === 'object' ? l.target : allNodes[l.target];
        if (source && target) {
          const sourceRadius = source.radius || 5;
          const targetRadius = target.radius || 5;
          const sourceRadiusPercent = maxRadius > minRadius 
            ? ((sourceRadius - minRadius) / (maxRadius - minRadius)) * 100
            : 100;
          const targetRadiusPercent = maxRadius > minRadius 
            ? ((targetRadius - minRadius) / (maxRadius - minRadius)) * 100
            : 100;
          
          // Masquer le lien si l'une des bulles est en dehors de la plage
          if (sourceRadiusPercent < sizeFilterMin || sourceRadiusPercent > sizeFilterMax ||
              targetRadiusPercent < sizeFilterMin || targetRadiusPercent > sizeFilterMax) {
            shouldShow = false;
          }
        }
      }
      
      if (shouldShow) {
        linkVisibleCount++;
        return 'block';
      } else {
        linkHiddenCount++;
        return 'none';
      }
    });
    
    console.log(`  🔗 ${linkVisibleCount} liens visibles, ${linkHiddenCount} liens masqués`);
  }
  
  // Filtrer les labels
  if (allLabels) {
    let labelVisibleCount = 0;
    let labelHiddenCount = 0;
    
    allLabels.style('display', (d) => {
      let shouldShow = true;
      
      if (searchFilterActive && !searchConnectedNodes.has(d.id)) {
        shouldShow = false;
      }
      
      // Filtre "Labels only" - afficher uniquement les labels des nœuds avec labels
      if (shouldShow && labelsOnlyFilterActive) {
        const label = d.label || getAddressLabel(d.address);
        if (!label) {
          shouldShow = false;
        }
      }
      
      // Filtre "PAD only" - afficher uniquement les labels des nœuds avec labels "PAD -"
      if (shouldShow && padOnlyFilterActive) {
        const label = d.label || getAddressLabel(d.address);
        if (!label || !label.startsWith('PAD -')) {
          shouldShow = false;
        }
      }
      
      // Filtre par taille de bulle pour les labels
      if (shouldShow) {
        const radius = d.radius || minRadius;
        
        // Masquer le label si le radius est inférieur à MIN_LABEL_RADIUS
        if (radius < MIN_LABEL_RADIUS) {
          shouldShow = false;
        } else {
          // Vérifier aussi le filtre de taille (en pourcentage)
          const radiusPercent = maxRadius > minRadius 
            ? ((radius - minRadius) / (maxRadius - minRadius)) * 100
            : 100;
          
          if (radiusPercent < sizeFilterMin || radiusPercent > sizeFilterMax) {
            shouldShow = false;
          }
        }
      }
      
      if (shouldShow) {
        labelVisibleCount++;
        return 'block';
      } else {
        labelHiddenCount++;
        return 'none';
      }
    });
    
    console.log(`  🏷️ ${labelVisibleCount} labels visibles, ${labelHiddenCount} labels masqués`);
  }
}

// Fonction pour mettre à jour l'affichage des valeurs du filtre de taille
function updateSizeFilterDisplay() {
  const minValueDisplay = document.getElementById('size-filter-min-value');
  const maxValueDisplay = document.getElementById('size-filter-max-value');
  if (minValueDisplay) {
    minValueDisplay.textContent = sizeFilterMin.toFixed(0);
  }
  if (maxValueDisplay) {
    maxValueDisplay.textContent = sizeFilterMax.toFixed(0);
  }
}

// Fonction pour filtrer les données par blockNumber (timeline)
function filterDataByBlockNumber(blockNumberLimit) {
  if (!originalAddressesData || originalAddressesData.length === 0) {
    return originalAddressesData;
  }
  
  // Filtrer les transfers et recalculer les balances
  const filteredData = originalAddressesData.map(addr => {
    // Filtrer les transfers jusqu'au blockNumber limite
    const filteredTransfers = (addr.transfers || []).filter(t => 
      (t.blockNumber || 0) <= blockNumberLimit
    );
    
    // Recalculer les balances basées sur les transfers filtrés
    let inAmount = BigInt(0);
    let outAmount = BigInt(0);
    
    filteredTransfers.forEach(t => {
      const amount = BigInt(t.amount || '0');
      if (t.type === 'in') {
        inAmount += amount;
      } else if (t.type === 'out') {
        outAmount += amount;
      }
    });
    
    const balance = inAmount - outAmount;
    const absBalance = balance < 0n ? -balance : balance;
    
    // Retourner l'adresse seulement si elle a une activité (transfers ou balance non nulle)
    // Note: on garde toutes les adresses pour maintenir la cohérence des IDs, mais on les marquera comme inactives
    return {
      ...addr,
      transfers: filteredTransfers,
      in: inAmount.toString(),
      out: outAmount.toString(),
      balance: balance.toString(),
      hasActivity: filteredTransfers.length > 0 || absBalance > 0n
    };
  });
  
  return filteredData;
}

// Fonction pour mettre à jour l'affichage de la timeline
function updateTimelineDisplay(position) {
  const timelineValue = document.getElementById('timeline-value');
  const timelineBlock = document.getElementById('timeline-block');
  
  if (position >= 100) {
    // Toutes les données
    if (timelineValue) {
      timelineValue.textContent = 'Toutes les données';
    }
    if (timelineBlock) {
      timelineBlock.textContent = `Block: ${maxBlockNumber}`;
    }
  } else if (position <= 0) {
    // Début (passé)
    if (timelineValue) {
      timelineValue.textContent = 'Début';
    }
    if (timelineBlock) {
      timelineBlock.textContent = `Block: ${minBlockNumber}`;
    }
  } else {
    // Calculer le blockNumber correspondant
    const blockRange = maxBlockNumber - minBlockNumber;
    const currentBlock = Math.floor(minBlockNumber + (blockRange * position / 100));
    
    if (timelineValue) {
      timelineValue.textContent = `Position: ${position.toFixed(1)}%`;
    }
    if (timelineBlock) {
      timelineBlock.textContent = `Block: ${currentBlock}`;
    }
  }
  
  // Mettre à jour le bouton de direction
  const reverseButton = document.getElementById('timeline-reverse');
  if (reverseButton) {
    if (timelineDirection < 0) {
      reverseButton.textContent = '⏪';
      reverseButton.title = 'Aller vers le futur';
    } else {
      reverseButton.textContent = '⏩';
      reverseButton.title = 'Aller vers le passé';
    }
  }
}

// Gestionnaire pour le filtre des bulles OUT
const hideOutCheckbox = document.getElementById('hide-out-bubbles');
if (hideOutCheckbox) {
  hideOutCheckbox.addEventListener('change', (e) => {
    hideOutBubbles = e.target.checked;
    updateVisualization();
  });
}

// Gestionnaires pour le filtre de taille (double slider)
const sizeFilterMinInput = document.getElementById('size-filter-min');
const sizeFilterMaxInput = document.getElementById('size-filter-max');

if (sizeFilterMinInput && sizeFilterMaxInput) {
  // Fonction pour s'assurer que min <= max
  function updateSizeFilter() {
    const minValue = parseInt(sizeFilterMinInput.value, 10);
    const maxValue = parseInt(sizeFilterMaxInput.value, 10);
    
    // S'assurer que min <= max
    if (minValue > maxValue) {
      if (sizeFilterMinInput === document.activeElement) {
        sizeFilterMaxInput.value = minValue;
        sizeFilterMax = minValue;
      } else {
        sizeFilterMinInput.value = maxValue;
        sizeFilterMin = maxValue;
      }
    } else {
      sizeFilterMin = minValue;
      sizeFilterMax = maxValue;
    }
    
    updateSizeFilterDisplay();
    updateVisualization();
  }
  
  sizeFilterMinInput.addEventListener('input', updateSizeFilter);
  sizeFilterMinInput.addEventListener('change', updateSizeFilter);
  sizeFilterMaxInput.addEventListener('input', updateSizeFilter);
  sizeFilterMaxInput.addEventListener('change', updateSizeFilter);
}

// Fonction pour mettre à jour les bulles existantes avec les nouvelles données (smooth)
function updateBubblesFromTimeline() {
  if (!allBubbles || !allNodes) {
    // Si les bulles n'existent pas encore, créer la bubble map
    createBubbleMap();
    return;
  }
  
  // Recalculer la taille max basée sur l'écran
  const headerHeight = document.querySelector('header').offsetHeight;
  const width = window.innerWidth;
  const height = window.innerHeight - headerHeight;
  const screenSize = Math.min(width, height);
  const currentMaxRadius = screenSize / 10;
  const currentMinRadius = 2;
  
  // Regrouper les adresses par label si nécessaire
  const { groupedData, addressToGroupMap: groupMap } = groupAddressesByLabel(addressesData);
  groupedAddressesData = groupedData;
  addressToGroupMap = groupMap;
  
  // Créer un map pour trouver rapidement les données par adresse/groupe
  const addressDataMap = new Map();
  groupedData.forEach(addr => {
    const key = addr.isGroup ? addr.label : addr.address.toLowerCase();
    addressDataMap.set(key, addr);
  });
  
  // Mettre à jour chaque nœud avec les nouvelles données
  allNodes.forEach(node => {
    // Pour les groupes, utiliser le label comme clé, sinon l'adresse
    const key = node.isGroup && node.label ? node.label : node.address.toLowerCase();
    const addrData = addressDataMap.get(key);
    const bubble = allBubbles.filter(d => d.id === node.id);
    
    // Vérifier si l'adresse existe dans les données filtrées et a une activité
    const hasTransfers = addrData && addrData.transfers && addrData.transfers.length > 0;
    const balance = addrData ? BigInt(addrData.balance) : 0n;
    const absBalance = balance < 0n ? -balance : balance;
    // Utiliser hasActivity de addrData si disponible, sinon calculer
    const hasActivity = addrData?.hasActivity !== undefined 
      ? addrData.hasActivity 
      : (hasTransfers || absBalance > 0n);
    
    if (addrData && hasActivity) {
      // Mettre à jour les données du nœud
      node.in = addrData.in;
      node.out = addrData.out;
      node.balance = addrData.balance;
      node.transfers = addrData.transfers || [];
      // Mettre à jour les propriétés de groupe si nécessaire
      if (addrData.isGroup !== undefined) {
        node.isGroup = addrData.isGroup;
        node.addresses = addrData.addresses || [];
      }
      
      // Recalculer le radius basé sur la nouvelle balance
      const hasLabel = node.label || getAddressLabel(node.address);
      
      let newRadius;
      if (absBalance === 0n) {
        newRadius = currentMinRadius;
      } else {
        const balanceNum = Number(absBalance);
        const totalSupplyNum = Number(TOTAL_SUPPLY);
        const proportion = balanceNum / totalSupplyNum;
        newRadius = currentMinRadius + (proportion * (currentMaxRadius - currentMinRadius));
        newRadius = Math.max(currentMinRadius, Math.min(currentMaxRadius, newRadius));
      }
      
      // Si la bulle a un label, s'assurer qu'elle a au moins MIN_LABEL_RADIUS
      if (hasLabel && newRadius < MIN_LABEL_RADIUS) {
        newRadius = MIN_LABEL_RADIUS;
      }
      
      // Mettre à jour le radius du nœud
      node.radius = newRadius;
      
      // Afficher la bulle avec transition smooth
      if (bubble.size() > 0) {
        bubble
          .transition()
          .duration(500)
          .ease(d3.easeCubicOut)
          .attr('r', newRadius)
          .style('opacity', 1)
          .style('visibility', 'visible')
          .style('pointer-events', 'all');
        
        // classed doit être appelé séparément (ne peut pas être chaîné après style)
        bubble.classed('filtered-out', false);
      }
    } else {
      // Masquer la bulle si elle n'existe pas encore ou n'a pas d'activité à cette date
      if (bubble.size() > 0) {
        bubble
          .transition()
          .duration(500)
          .ease(d3.easeCubicOut)
          .style('opacity', 0)
          .style('visibility', 'hidden')
          .style('pointer-events', 'none');
        
        // classed doit être appelé séparément (ne peut pas être chaîné après style)
        bubble.classed('filtered-out', true);
      }
      
      // Mettre à jour les données du nœud même si masqué
      if (addrData) {
        node.in = addrData.in;
        node.out = addrData.out;
        node.balance = addrData.balance;
        node.transfers = addrData.transfers || [];
      } else {
        // Si l'adresse n'existe pas dans les données filtrées, réinitialiser
        node.in = '0';
        node.out = '0';
        node.balance = '0';
        node.transfers = [];
      }
      node.radius = currentMinRadius;
    }
  });
  
  // Recalculer les liens basés sur les nouvelles données
  const newLinksData = buildConnectionGraph(addressesData, addressToGroupMap, groupedAddressesData);
  
  // Convertir les indices en références aux nœuds pour D3
  // Filtrer les liens invalides (nœuds manquants)
  const newLinks = newLinksData
    .filter(link => {
      const sourceNode = allNodes[link.source];
      const targetNode = allNodes[link.target];
      if (!sourceNode || !targetNode) {
        console.warn(`⚠️ Lien invalide ignoré: source=${link.source}, target=${link.target}`);
        return false;
      }
      return true;
    })
    .map(link => ({
      source: allNodes[link.source],
      target: allNodes[link.target],
      value: link.value,
      count: link.count
    }));
  
  // Mettre à jour la force de collision avec les nouveaux radius
  if (simulation) {
    simulation.force('collision', d3.forceCollide().radius(d => {
      return (d.radius || currentMinRadius) + 1;
    }));
    
    // Mettre à jour la force de lien si nécessaire
    if (newLinks && newLinks.length > 0) {
      simulation.force('link', d3.forceLink(newLinks)
        .id(d => d.id)
        .distance(d => {
          const sourceRadius = typeof d.source === 'object' ? d.source.radius : allNodes[d.source].radius;
          const targetRadius = typeof d.target === 'object' ? d.target.radius : allNodes[d.target].radius;
          const minDistance = sourceRadius + targetRadius + 5;
          const maxDistance = minDistance * 1.5;
          const connectionFactor = Math.min(1, 1 / Math.log10(d.count + 2));
          return minDistance + (maxDistance - minDistance) * connectionFactor;
        })
        .strength(1.0));
    } else {
      // Supprimer la force de lien s'il n'y a plus de liens
      simulation.force('link', null);
    }
    
    // Ne relancer la simulation que si on n'est pas en mode lecture automatique
    // Pendant la lecture, on stabilise la simulation pour éviter les mouvements constants
    if (timelinePlaying) {
      // Stabiliser la simulation immédiatement pendant la lecture
      simulation.alphaTarget(0);
      simulation.alpha(0);
    } else {
      // Relancer la simulation doucement pour réorganiser les positions
      simulation.alphaTarget(0);
      simulation.alpha(0.3).restart();
    }
  }
  
  // Mettre à jour les liens existants
  const svg = d3.select('#bubble-map');
  
  if (newLinks.length > 0) {
    // Utiliser une clé unique pour identifier les liens (sourceId-targetId)
    const linkSelection = svg.selectAll('.link').data(newLinks, d => {
      const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
      const targetId = typeof d.target === 'object' ? d.target.id : d.target;
      // Créer une clé unique (toujours dans le même ordre pour éviter les doublons)
      const key1 = sourceId < targetId ? sourceId : targetId;
      const key2 = sourceId < targetId ? targetId : sourceId;
      return `${key1}-${key2}`;
    });
    
    // Supprimer les liens qui n'existent plus
    linkSelection.exit()
      .transition()
      .duration(300)
      .style('opacity', 0)
      .remove();
    
    // Créer les nouveaux liens
    const newLinkElements = linkSelection.enter()
      .append('line')
      .attr('class', 'link')
      .attr('stroke', '#999')
      .attr('stroke-opacity', 0)
      .attr('stroke-width', d => Math.max(1, Math.min(3, Math.log10(d.value + 1) / 2)))
      .attr('x1', d => {
        const source = typeof d.source === 'object' ? d.source : allNodes[d.source];
        return source ? (source.x || width / 2) : width / 2;
      })
      .attr('y1', d => {
        const source = typeof d.source === 'object' ? d.source : allNodes[d.source];
        return source ? (source.y || height / 2) : height / 2;
      })
      .attr('x2', d => {
        const target = typeof d.target === 'object' ? d.target : allNodes[d.target];
        return target ? (target.x || width / 2) : width / 2;
      })
      .attr('y2', d => {
        const target = typeof d.target === 'object' ? d.target : allNodes[d.target];
        return target ? (target.y || height / 2) : height / 2;
      });
    
    // Animer l'apparition des nouveaux liens
    newLinkElements
      .transition()
      .duration(300)
      .style('opacity', 0.3);
    
    // Mettre à jour les liens existants
    linkSelection
      .transition()
      .duration(300)
      .attr('stroke-width', d => Math.max(1, Math.min(3, Math.log10(d.value + 1) / 2)));
    
    // Fusionner
    allLinks = newLinkElements.merge(linkSelection);
    allLinksData = newLinks;
    
    console.log(`🔗 ${newLinks.length} liens mis à jour (${newLinkElements.size()} nouveaux, ${linkSelection.size()} existants)`);
  } else {
    // Si pas de liens, masquer tous les liens existants
    if (allLinks) {
      allLinks
        .transition()
        .duration(300)
        .style('opacity', 0)
        .remove();
    }
    allLinks = svg.selectAll('.link'); // Sélection vide mais valide
    allLinksData = [];
    console.log('🔗 Aucun lien à afficher');
  }
  
  // Mettre à jour les labels
  if (allLabels) {
    allLabels.each(function(d) {
      const label = d3.select(this);
      const node = allNodes.find(n => n.id === d.id);
      
      if (node) {
        // Vérifier si la bulle est visible (a une activité)
        const addrData = addressDataMap.get(node.address.toLowerCase());
        const hasTransfers = addrData && addrData.transfers && addrData.transfers.length > 0;
        const balance = addrData ? BigInt(addrData.balance) : 0n;
        const absBalance = balance < 0n ? -balance : balance;
        const hasActivity = hasTransfers || absBalance > 0n;
        
        if (hasActivity && node.radius >= MIN_LABEL_RADIUS) {
          label
            .style('display', 'block')
            .style('font-size', () => {
              const fontSize = Math.max(8, Math.min(14, node.radius * 0.4));
              return `${fontSize}px`;
            });
        } else {
          label.style('display', 'none');
        }
      }
    });
  }
  
  // Recalculer les tailles des bulles visibles pour mieux utiliser l'espace
  // Ne pas recalculer pendant la lecture automatique pour éviter les sauts
  if (!timelinePlaying) {
    recalculateVisibleBubbleSizes();
  }
}

// Fonction pour mettre à jour la timeline (utilisée par le slider et le play)
function updateTimelinePosition(position) {
  // S'assurer que la position est valide (entre 0 et 100)
  const clampedPosition = Math.max(0, Math.min(100, position));
  
  // Ne pas mettre à jour si la position n'a pas changé significativement
  if (Math.abs(clampedPosition - timelinePosition) < 0.01 && timelinePosition !== 0 && timelinePosition !== 100) {
    return;
  }
  
  timelinePosition = clampedPosition;
  
  // Mettre à jour le slider sans déclencher d'événement
  if (timelineSlider && parseInt(timelineSlider.value, 10) !== clampedPosition) {
    // Utiliser un flag pour éviter les boucles infinies
    const wasUpdating = window._isUpdatingTimelineSlider;
    window._isUpdatingTimelineSlider = true;
    timelineSlider.value = clampedPosition;
    window._isUpdatingTimelineSlider = wasUpdating;
  }
  
  updateTimelineDisplay(clampedPosition);
  
  // Filtrer les données par blockNumber
  if (position >= 100) {
    // Toutes les données
    addressesData = originalAddressesData;
  } else if (position <= 0) {
    // Position à 0% ou moins - pas de données
    addressesData = filterDataByBlockNumber(minBlockNumber - 1);
  } else {
    // Calculer le blockNumber limite
    const blockRange = maxBlockNumber - minBlockNumber;
    if (blockRange <= 0) {
      // Si pas de range, utiliser toutes les données
      addressesData = originalAddressesData;
    } else {
      // Calculer le blockNumber limite en fonction de la position
      // Position 0% = minBlockNumber, Position 100% = maxBlockNumber
      const blockNumberLimit = Math.floor(minBlockNumber + (blockRange * position / 100));
      
      // S'assurer que le blockNumber est dans les limites
      const clampedBlockNumber = Math.max(minBlockNumber, Math.min(maxBlockNumber, blockNumberLimit));
      
      // Debug: seulement si position < 10% pour éviter trop de logs
      if (position < 10) {
        console.log(`📅 Timeline: position=${position.toFixed(2)}%, blockNumberLimit=${clampedBlockNumber} (range: ${minBlockNumber}-${maxBlockNumber})`);
      }
      
      addressesData = filterDataByBlockNumber(clampedBlockNumber);
      
      // Vérifier que les données sont valides
      if (!addressesData || addressesData.length === 0) {
        console.warn(`⚠️ Aucune donnée filtrée pour position ${position}%, blockNumber ${clampedBlockNumber}`);
        // Utiliser les données originales si le filtre retourne vide
        addressesData = originalAddressesData;
      }
    }
  }
  
  // Mettre à jour le compteur de transfers
  const totalTransfers = addressesData.reduce((sum, addr) => sum + (addr.transfers?.length || 0), 0);
  document.getElementById('total-transfers').textContent = totalTransfers;
  
  // Mettre à jour les bulles existantes de façon smooth au lieu de recréer
  updateBubblesFromTimeline();
}

// Fonction pour démarrer/arrêter la lecture automatique
function toggleTimelinePlay() {
  const playButton = document.getElementById('timeline-play');
  
  if (timelinePlaying) {
    // Arrêter la lecture
    if (timelineInterval) {
      clearInterval(timelineInterval);
      timelineInterval = null;
    }
    timelinePlaying = false;
    if (playButton) {
      playButton.textContent = '▶️';
      playButton.title = 'Play';
    }
    
    // Relancer la simulation pour stabiliser les positions après la pause
    // Libérer les positions fixes pour permettre le repositionnement
    if (simulation && allNodes) {
      allNodes.forEach(node => {
        node.fx = null;
        node.fy = null;
      });
      simulation.alphaTarget(0);
      simulation.alpha(0.3).restart();
    }
  } else {
    // Démarrer la lecture
    timelinePlaying = true;
    if (playButton) {
      playButton.textContent = '⏸️';
      playButton.title = 'Pause';
    }
    
    // Stabiliser la simulation avant de démarrer la lecture
    // Fixer les positions de tous les nœuds pour qu'ils ne bougent pas
    if (simulation && allNodes) {
      allNodes.forEach(node => {
        node.fx = node.x;
        node.fy = node.y;
      });
      simulation.alphaTarget(0);
      simulation.alpha(0);
    }
    
    // Avancer automatiquement dans le temps selon la direction
    timelineInterval = setInterval(() => {
      const currentPos = timelinePosition; // Sauvegarder la position actuelle
      // Avancer selon la direction: -1 = remonter (diminuer), 1 = avancer (augmenter)
      const newPosition = Math.max(0, Math.min(100, currentPos + (timelineSpeed * timelineDirection)));
      
      // S'assurer que la nouvelle position est valide et différente de l'actuelle
      if (newPosition <= 0 && timelineDirection < 0) {
        // Arrivé au début en remontant, arrêter la lecture
        toggleTimelinePlay();
        updateTimelinePosition(0);
      } else if (newPosition >= 100 && timelineDirection > 0) {
        // Arrivé à la fin en avançant, arrêter la lecture
        toggleTimelinePlay();
        updateTimelinePosition(100);
      } else if (Math.abs(newPosition - currentPos) > 0.01) {
        // Mettre à jour seulement si la position a changé significativement
        updateTimelinePosition(newPosition);
      }
    }, 100); // Mise à jour toutes les 100ms pour une animation fluide
  }
}

// Gestionnaire pour la timeline
const timelineSlider = document.getElementById('timeline-slider');
if (timelineSlider) {
  timelineSlider.addEventListener('input', (e) => {
    // Éviter les mises à jour en boucle (si c'est une mise à jour programmatique)
    if (window._isUpdatingTimelineSlider) return;
    
    const position = parseInt(e.target.value, 10);
    
    // Arrêter la lecture automatique si l'utilisateur déplace le slider manuellement
    if (timelinePlaying) {
      toggleTimelinePlay();
    }
    
    // Ne mettre à jour que si la position a vraiment changé
    if (Math.abs(position - timelinePosition) > 0.1) {
      updateTimelinePosition(position);
    }
  });
  
  timelineSlider.addEventListener('change', (e) => {
    const position = parseInt(e.target.value, 10);
    updateTimelineDisplay(position);
    
    // Relancer la simulation après le changement manuel pour stabiliser les positions
    if (simulation && !timelinePlaying) {
      simulation.alphaTarget(0);
      simulation.alpha(0.3).restart();
    }
  });
}

// Gestionnaire pour le bouton play/pause
const timelinePlayButton = document.getElementById('timeline-play');
if (timelinePlayButton) {
  timelinePlayButton.addEventListener('click', () => {
    toggleTimelinePlay();
  });
}

// Gestionnaire pour le bouton d'inversion de direction
const timelineReverseButton = document.getElementById('timeline-reverse');
if (timelineReverseButton) {
  timelineReverseButton.addEventListener('click', () => {
    // Inverser la direction
    timelineDirection = -timelineDirection;
    
    // Mettre à jour l'affichage
    updateTimelineDisplay(timelinePosition);
    
    // Si on est en train de jouer, continuer dans la nouvelle direction
    if (timelinePlaying) {
      // La direction sera utilisée dans le prochain interval
    }
  });
}

// Gestionnaire pour le bouton "Masquer tout sauf Labels"
const showLabelsOnlyBtn = document.getElementById('show-labels-only');
if (showLabelsOnlyBtn) {
  showLabelsOnlyBtn.addEventListener('click', () => {
    labelsOnlyFilterActive = !labelsOnlyFilterActive;
    // Désactiver le filtre PAD si on active le filtre labels
    if (labelsOnlyFilterActive) {
      padOnlyFilterActive = false;
      showPadOnlyBtn.textContent = 'Afficher uniquement PAD -';
      showPadOnlyBtn.classList.remove('active');
      showLabelsOnlyBtn.textContent = 'Afficher tout';
      showLabelsOnlyBtn.classList.add('active');
    } else {
      showLabelsOnlyBtn.textContent = 'Masquer tout sauf Labels';
      showLabelsOnlyBtn.classList.remove('active');
    }
    updateVisualization();
  });
}

// Gestionnaire pour le bouton "Afficher uniquement PAD -"
const showPadOnlyBtn = document.getElementById('show-pad-only');
if (showPadOnlyBtn) {
  showPadOnlyBtn.addEventListener('click', () => {
    padOnlyFilterActive = !padOnlyFilterActive;
    // Désactiver le filtre labels si on active le filtre PAD
    if (padOnlyFilterActive) {
      labelsOnlyFilterActive = false;
      showLabelsOnlyBtn.textContent = 'Masquer tout sauf Labels';
      showLabelsOnlyBtn.classList.remove('active');
      showPadOnlyBtn.textContent = 'Afficher tout';
      showPadOnlyBtn.classList.add('active');
    } else {
      showPadOnlyBtn.textContent = 'Afficher uniquement PAD -';
      showPadOnlyBtn.classList.remove('active');
    }
    updateVisualization();
  });
}

// Gestionnaire pour la profondeur de recherche
const searchDepthInput = document.getElementById('search-depth');
if (searchDepthInput) {
  searchDepthInput.addEventListener('change', (e) => {
    const newDepth = parseInt(e.target.value, 10);
    if (newDepth >= 1 && newDepth <= 10) {
      searchDepth = newDepth;
      console.log('📏 Profondeur de recherche changée:', searchDepth);
      // Si une recherche est active, relancer avec la nouvelle profondeur
      if (searchFilterActive && addressSearchInput && addressSearchInput.value.trim()) {
        applySearchFilter(addressSearchInput.value.trim());
      }
    }
  });
}

// Gestionnaire pour la recherche d'adresse
const addressSearchInput = document.getElementById('address-search');
const clearSearchBtn = document.getElementById('clear-search');

if (addressSearchInput) {
  // Attendre que les données soient chargées avant d'activer la recherche
  let searchReady = false;
  
  // Activer la recherche après un court délai pour s'assurer que tout est initialisé
  setTimeout(() => {
    searchReady = true;
    console.log('✅ Recherche prête - allNodes:', allNodes ? allNodes.length : 'non défini');
  }, 1000);
  
  addressSearchInput.addEventListener('input', (e) => {
    const searchValue = e.target.value.trim();
    if (searchValue) {
      clearSearchBtn.style.display = 'block';
      // Vérifier seulement allNodes, allLinksData peut être vide
      if (allNodes && allNodes.length > 0) {
        applySearchFilter(searchValue);
      } else {
        console.log('⏳ Données pas encore chargées, attente...');
        setTimeout(() => {
          if (allNodes && allNodes.length > 0) {
            applySearchFilter(searchValue);
          } else {
            alert('Les données ne sont pas encore chargées. Veuillez patienter...');
          }
        }, 500);
      }
    } else {
      clearSearchBtn.style.display = 'none';
      searchFilterActive = false;
      searchConnectedNodes.clear();
      updateVisualization();
    }
  });
  
  // Rechercher aussi avec Enter
  addressSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const searchValue = e.target.value.trim();
      if (searchValue && allNodes && allNodes.length > 0) {
        applySearchFilter(searchValue);
      }
    }
  });
}

if (clearSearchBtn) {
  clearSearchBtn.addEventListener('click', () => {
    addressSearchInput.value = '';
    clearSearchBtn.style.display = 'none';
    searchFilterActive = false;
    searchConnectedNodes.clear();
    updateVisualization();
  });
}

// Gérer le redimensionnement de la fenêtre
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (simulation && allBubbles) {
      // Recréer la bubble map pour recalculer les tailles avec la nouvelle taille d'écran
      createBubbleMap();
    }
  }, 250);
});

// Charger les données au démarrage
// Fonction pour détecter et animer les nouveaux transfers
function updateVisualizationWithNewTransfers(newAddressesData) {
  const newTxHashes = new Set();
  const newAddresses = new Map();
  const updatedAddresses = new Map();
  
  // Collecter les nouveaux transfers et adresses
  newAddressesData.forEach(addr => {
    const addrKey = addr.address.toLowerCase();
    const oldAddr = knownAddresses.get(addrKey);
    
    if (addr.transfers) {
      addr.transfers.forEach(t => {
        const txHash = t.txHash ? t.txHash.toLowerCase() : null;
        if (txHash && !knownTxHashes.has(txHash)) {
          newTxHashes.add(txHash);
        }
      });
    }
    
    // Détecter les adresses avec des changements de balance
    if (oldAddr) {
      if (oldAddr.balance !== addr.balance || oldAddr.in !== addr.in || oldAddr.out !== addr.out) {
        updatedAddresses.set(addrKey, {
          old: oldAddr,
          new: {
            balance: addr.balance,
            in: addr.in,
            out: addr.out
          }
        });
      }
    } else {
      // Nouvelle adresse
      newAddresses.set(addrKey, addr);
    }
    
    // Mettre à jour les données connues
    knownAddresses.set(addrKey, {
      balance: addr.balance,
      in: addr.in,
      out: addr.out
    });
  });
  
  // Ajouter les nouveaux txHash au set
  newTxHashes.forEach(txHash => knownTxHashes.add(txHash));
  
  // Mettre à jour les données
  addressesData = newAddressesData;
  
  // Mettre à jour les statistiques avec transition
  const totalTransfers = addressesData.reduce((sum, addr) => sum + (addr.transfers?.length || 0), 0);
  const totalAddresses = addressesData.length;
  
  // Animer les changements de statistiques
  const transfersElement = document.getElementById('total-transfers');
  const addressesElement = document.getElementById('total-addresses');
  
  if (transfersElement && parseInt(transfersElement.textContent) !== totalTransfers) {
    animateNumberChange(transfersElement, parseInt(transfersElement.textContent) || 0, totalTransfers);
  }
  if (addressesElement && parseInt(addressesElement.textContent) !== totalAddresses) {
    animateNumberChange(addressesElement, parseInt(addressesElement.textContent) || 0, totalAddresses);
  }
  
  // Animer les nouvelles bulles
  if (newAddresses.size > 0 && allBubbles) {
    animateNewBubbles(newAddresses);
  }
  
  // Animer les transfers sur les bulles existantes
  if (updatedAddresses.size > 0 && allBubbles) {
    animateTransferOnExistingBubbles(updatedAddresses);
  }
  
  // Recréer la visualisation si nécessaire (avec transition fluide)
  if (newAddresses.size > 0) {
    // Attendre un peu pour que les animations précédentes se terminent
    setTimeout(() => {
      createBubbleMap();
    }, 300);
  } else if (updatedAddresses.size > 0) {
    // Mettre à jour les tailles des bulles existantes avec transition
    updateExistingBubbles(updatedAddresses);
  }
}

// Fonction pour animer les changements de nombres
function animateNumberChange(element, from, to) {
  const duration = 500;
  const startTime = Date.now();
  const difference = to - from;
  
  function update() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic
    const current = Math.round(from + (difference * easeProgress));
    element.textContent = current;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = to;
    }
  }
  
  update();
}

// Fonction pour animer l'apparition des nouvelles bulles
function animateNewBubbles(newAddresses) {
  console.log(`✨ ${newAddresses.size} nouvelles adresses détectées`);
  
  // Les nouvelles bulles seront créées lors du prochain createBubbleMap
  // On peut ajouter une animation d'apparition ici
}

// Fonction pour animer les transfers sur les bulles existantes
function animateTransferOnExistingBubbles(updatedAddresses) {
  console.log(`🔄 ${updatedAddresses.size} adresses mises à jour`);
  
  if (!allBubbles || !allNodes) return;
  
  updatedAddresses.forEach((update, addrKey) => {
    // Trouver la bulle correspondante
    const node = allNodes.find(n => n.address.toLowerCase() === addrKey);
    if (node && allBubbles) {
      const bubble = allBubbles.filter(d => d.address.toLowerCase() === addrKey);
      
      if (bubble.size() > 0) {
        // Animation de flash pour indiquer un nouveau transfer
        bubble
          .transition()
          .duration(200)
          .attr('stroke', '#ff6b6b')
          .attr('stroke-width', 6)
          .transition()
          .duration(200)
          .attr('stroke', '#fff')
          .attr('stroke-width', 2);
        
        // Animation de pulsation
        bubble
          .transition()
          .duration(300)
          .attr('r', d => (d.radius || 5) * 1.2)
          .transition()
          .duration(300)
          .attr('r', d => d.radius || 5);
      }
    }
  });
}

// Fonction pour mettre à jour les bulles existantes avec les nouvelles tailles
function updateExistingBubbles(updatedAddresses) {
  if (!allBubbles || !allNodes) return;
  
  // Recalculer la taille maximum basée sur la taille d'écran actuelle
  const headerHeight = document.querySelector('header').offsetHeight;
  const width = window.innerWidth;
  const height = window.innerHeight - headerHeight;
  const screenSize = Math.min(width, height);
  const currentMaxRadius = screenSize / 10;
  const currentMinRadius = 2;
  
  // Mettre à jour les nœuds avec les nouvelles tailles
  allNodes.forEach(node => {
    const addr = addressesData.find(a => a.address.toLowerCase() === node.address.toLowerCase());
    if (addr) {
      const balance = BigInt(addr.balance);
      const absBalance = balance < 0n ? -balance : balance;
      
      // Vérifier si le nœud a un label
      const hasLabel = node.label || getAddressLabel(node.address);
      
      // Calculer le radius proportionnellement à la balance par rapport au TOTAL_SUPPLY
      let newRadius;
      if (absBalance === 0n) {
        newRadius = currentMinRadius;
      } else {
        const balanceNum = Number(absBalance);
        const totalSupplyNum = Number(TOTAL_SUPPLY);
        const proportion = balanceNum / totalSupplyNum;
        
        // Calculer le radius proportionnellement
        newRadius = currentMinRadius + (proportion * (currentMaxRadius - currentMinRadius));
        
        // S'assurer que le radius est dans les limites
        newRadius = Math.max(currentMinRadius, Math.min(currentMaxRadius, newRadius));
      }
      
      // Si la bulle a un label, s'assurer qu'elle a au moins MIN_LABEL_RADIUS
      if (hasLabel && newRadius < MIN_LABEL_RADIUS) {
        newRadius = MIN_LABEL_RADIUS;
      }
      
      // Mettre à jour maxRadius global si nécessaire
      if (newRadius > maxRadius) {
        maxRadius = newRadius;
      }
      
      // Animer le changement de taille avec transition fluide
      const bubble = allBubbles.filter(d => d.id === node.id);
      if (bubble.size() > 0 && node.radius !== newRadius) {
        bubble
          .transition()
          .duration(800)
          .ease(d3.easeCubicOut)
          .attr('r', newRadius);
        node.radius = newRadius;
      }
    }
  });
}

// Gestion du mode sombre
function initDarkMode() {
  const darkModeToggle = document.getElementById('dark-mode-toggle');
  const isDarkMode = localStorage.getItem('darkMode') === 'true';
  
  // Appliquer le mode sombre si sauvegardé
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
    darkModeToggle.textContent = '☀️';
  }
  
  // Gestionnaire d'événement pour basculer le mode
  darkModeToggle.addEventListener('click', () => {
    const isCurrentlyDark = document.body.classList.contains('dark-mode');
    
    if (isCurrentlyDark) {
      document.body.classList.remove('dark-mode');
      darkModeToggle.textContent = '🌙';
      localStorage.setItem('darkMode', 'false');
    } else {
      document.body.classList.add('dark-mode');
      darkModeToggle.textContent = '☀️';
      localStorage.setItem('darkMode', 'true');
    }
  });
}

// Initialiser le mode sombre au chargement
initDarkMode();

// Charger les données initiales
loadData();

// Recharger les données toutes les 30 secondes
setInterval(() => {
  console.log('🔄 Rechargement des données...');
  loadData();
}, 30000);

