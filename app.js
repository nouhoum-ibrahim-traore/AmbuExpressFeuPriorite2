import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  onValue
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyB7tMeD5fRFNyfJmI44Aa11ydhjfma1vq0",
  authDomain: "esp32ledcontrol-b2562.firebaseapp.com",
  databaseURL: "https://esp32ledcontrol-b2562-default-rtdb.firebaseio.com",
  projectId: "esp32ledcontrol-b2562",
  storageBucket: "esp32ledcontrol-b2562.firebasestorage.app",
  messagingSenderId: "185925528006",
  appId: "1:185925528006:web:873dea6359af852278aac7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getDatabase(app);

const authBox = document.getElementById("authBox");
const controlBox = document.getElementById("controlBox");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authMsg = document.getElementById("authMsg");
const badge = document.getElementById("statusBadge");

// Boutons priorité pour chaque axe
const priorityBtnNS = document.getElementById("priorityBtnNS");
const priorityBtnOE = document.getElementById("priorityBtnOE");
const priorityStatus = document.getElementById("priorityStatus");
const countdownEl = document.getElementById("countdown");
const prioritySection = document.querySelector(".priority-section");

// Feu 1 (Nord-Sud) - GPIO 1,2,3
const feu1 = {
  vert: document.getElementById("feu1Vert"),
  orange: document.getElementById("feu1Orange"),
  rouge: document.getElementById("feu1Rouge"),
  labels: {
    vert: document.getElementById("feu1VertStatus"),
    orange: document.getElementById("feu1OrangeStatus"),
    rouge: document.getElementById("feu1RougeStatus")
  }
};

// Feu 2 (Ouest-Est) - GPIO 4,5,6
const feu2 = {
  vert: document.getElementById("feu2Vert"),
  orange: document.getElementById("feu2Orange"),
  rouge: document.getElementById("feu2Rouge"),
  labels: {
    vert: document.getElementById("feu2VertStatus"),
    orange: document.getElementById("feu2OrangeStatus"),
    rouge: document.getElementById("feu2RougeStatus")
  }
};

// Variables d'état
let priorityMode = false;
let priorityAxis = null; // 'NS' ou 'OE'
let countdownInterval = null;
let blinkInterval = null;
let autoCycleInterval = null;
let currentPhase = 'feu1_vert'; // État du cycle

// Durées du cycle normal (en secondes)
const CYCLE = {
  feu1_vert: 30,   // NS Vert, OE Rouge
  feu1_orange: 5,  // NS Orange, OE Rouge
  feu2_vert: 30,   // NS Rouge, OE Vert
  feu2_orange: 5   // NS Rouge, OE Orange
};

// Connexion
loginBtn.onclick = async () => {
  authMsg.textContent = "";
  try {
    await signInWithEmailAndPassword(
      auth,
      document.getElementById("emailField").value,
      document.getElementById("passwordField").value
    );
  } catch (e) {
    authMsg.textContent = e.message;
  }
};

logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, (user) => {
  if (user) {
    authBox.style.display = "none";
    controlBox.style.display = "block";
    badge.className = "status-badge online";
    badge.textContent = "En ligne";
    startListeners();
    startAutoCycle();
  } else {
    authBox.style.display = "block";
    controlBox.style.display = "none";
    badge.className = "status-badge offline";
    badge.textContent = "Hors ligne";
    stopAllModes();
  }
});

// ========== GESTION DU CYCLE AUTOMATIQUE ==========

function startAutoCycle() {
  if (priorityMode) return;
  
  console.log("Démarrage cycle automatique 2 feux");
  currentPhase = 'feu1_vert';
  runCyclePhase();
}

function runCyclePhase() {
  if (priorityMode) return;
  
  let duration = CYCLE[currentPhase];
  
  // Envoyer l'état à Firebase selon la phase
  switch(currentPhase) {
    case 'feu1_vert':
      // Feu1 Vert, Feu2 Rouge
      updateTrafficLight('feu1', 'green');
      updateTrafficLight('feu2', 'red');
      break;
    case 'feu1_orange':
      // Feu1 Orange, Feu2 Rouge
      updateTrafficLight('feu1', 'orange');
      updateTrafficLight('feu2', 'red');
      break;
    case 'feu2_vert':
      // Feu1 Rouge, Feu2 Vert
      updateTrafficLight('feu1', 'red');
      updateTrafficLight('feu2', 'green');
      break;
    case 'feu2_orange':
      // Feu1 Rouge, Feu2 Orange
      updateTrafficLight('feu1', 'red');
      updateTrafficLight('feu2', 'orange');
      break;
  }
  
  // Affichage du temps restant
  let timeLeft = duration;
  updateCountdown(timeLeft);
  
  if (autoCycleInterval) clearInterval(autoCycleInterval);
  
  autoCycleInterval = setInterval(() => {
    if (priorityMode) {
      clearInterval(autoCycleInterval);
      return;
    }
    
    timeLeft--;
    updateCountdown(timeLeft);
    
    if (timeLeft <= 0) {
      // Passer à la phase suivante
      switch(currentPhase) {
        case 'feu1_vert': currentPhase = 'feu1_orange'; break;
        case 'feu1_orange': currentPhase = 'feu2_vert'; break;
        case 'feu2_vert': currentPhase = 'feu2_orange'; break;
        case 'feu2_orange': currentPhase = 'feu1_vert'; break;
      }
      runCyclePhase();
    }
  }, 1000);
}

function updateTrafficLight(feuId, color) {
  const gpioBase = feuId === 'feu1' ? 1 : 4; // Feu1: GPIO 1-3, Feu2: GPIO 4-6
  
  // Reset tous les GPIO du feu
  set(ref(db, `/feu${feuId}/gpio${gpioBase}`), 0);     // Vert
  set(ref(db, `/feu${feuId}/gpio${gpioBase + 1}`), 0); // Orange
  set(ref(db, `/feu${feuId}/gpio${gpioBase + 2}`), 0); // Rouge
  
  // Allume la bonne couleur
  switch(color) {
    case 'green':
      set(ref(db, `/feu${feuId}/gpio${gpioBase}`), 1);
      break;
    case 'orange':
      set(ref(db, `/feu${feuId}/gpio${gpioBase + 1}`), 1);
      break;
    case 'red':
      set(ref(db, `/feu${feuId}/gpio${gpioBase + 2}`), 1);
      break;
  }
  
  // Mise à jour UI
  updateFeuUI(feuId, color);
}

// ========== GESTION DU MODE PRIORITÉ ==========

priorityBtnNS.onclick = async () => {
  if (!priorityMode) {
    await activatePriorityMode('NS');
  } else if (priorityAxis === 'NS') {
    if (isModalOpen) return;
    if (confirm("Arrêter la priorité Nord-Sud ?")) {
      clearInterval(countdownInterval);
      clearInterval(autoReturnInterval);
      closeModal();
      await deactivatePriorityMode();
    }
  } else {
    alert("Une priorité est déjà active sur l'autre axe !");
  }
};

priorityBtnOE.onclick = async () => {
  if (!priorityMode) {
    await activatePriorityMode('OE');
  } else if (priorityAxis === 'OE') {
    if (isModalOpen) return;
    if (confirm("Arrêter la priorité Ouest-Est ?")) {
      clearInterval(countdownInterval);
      clearInterval(autoReturnInterval);
      closeModal();
      await deactivatePriorityMode();
    }
  } else {
    alert("Une priorité est déjà active sur l'autre axe !");
  }
};

async function activatePriorityMode(axis) {
  priorityMode = true;
  priorityAxis = axis;
  
  // Arrêter le cycle automatique
  if (autoCycleInterval) clearInterval(autoCycleInterval);
  
  const btn = axis === 'NS' ? priorityBtnNS : priorityBtnOE;
  const otherBtn = axis === 'NS' ? priorityBtnOE : priorityBtnNS;
  
  btn.classList.add("active");
  btn.textContent = axis === 'NS' ? "🛑 Désactiver Priorité NS" : "🛑 Désactiver Priorité OE";
  otherBtn.disabled = true;
  otherBtn.style.opacity = "0.5";
  
  priorityStatus.textContent = `Priorité ${axis}: Phase 1 - Clignotement (10s)`;
  priorityStatus.classList.add("active");
  prioritySection.classList.add("active");
  
  // Phase 1: Clignotement sur l'axe prioritaire, l'autre reste rouge
  await set(ref(db, "/mode"), `priority_${axis}_blink`);
  
  // L'autre feu passe au rouge immédiatement
  const otherAxis = axis === 'NS' ? 'feu2' : 'feu1';
  updateTrafficLight(otherAxis, 'red');
  
  startBlinkingSequence(axis, 10, async () => {
    await startPriorityGreenPhase(axis);
  });
}

// Variables pour le modal
let autoReturnInterval = null;
let autoReturnSeconds = 10;
let isModalOpen = false;

async function startPriorityGreenPhase(axis) {
  if (!priorityMode) return;
  
  priorityStatus.textContent = `Priorité ${axis}: Phase 2 - Vert (60s)`;
  
  await set(ref(db, "/mode"), `priority_${axis}_green`);
  
  // Feu prioritaire au vert, l'autre au rouge
  if (axis === 'NS') {
    updateTrafficLight('feu1', 'green');
    updateTrafficLight('feu2', 'red');
  } else {
    updateTrafficLight('feu1', 'red');
    updateTrafficLight('feu2', 'green');
  }
  
  let timeLeft = 60;
  updateCountdown(timeLeft);
  
  countdownInterval = setInterval(async () => {
    if (!priorityMode) return;
    
    timeLeft--;
    updateCountdown(timeLeft);
    
    if (timeLeft <= 10) {
      clearInterval(countdownInterval);
      openEndPriorityModal(axis);
    }
  }, 1000);
}

// ========== MODAL DE FIN DE PRIORITÉ ==========

function openEndPriorityModal(axis) {
  isModalOpen = true;
  const modal = document.getElementById("endPriorityModal");
  const autoSecondsSpan = document.getElementById("autoSeconds");
  const autoCountdownDiv = document.querySelector(".auto-countdown");
  const modalTitle = document.getElementById("modalTitle");
  
  modalTitle.textContent = `Fin de priorité ${axis}`;
  modal.style.display = "flex";
  autoReturnSeconds = 10;
  autoSecondsSpan.textContent = autoReturnSeconds;
  autoCountdownDiv.classList.remove("warning");
  
  autoReturnInterval = setInterval(() => {
    autoReturnSeconds--;
    autoSecondsSpan.textContent = autoReturnSeconds;
    
    if (autoReturnSeconds <= 5) {
      autoCountdownDiv.classList.add("warning");
    }
    
    if (autoReturnSeconds <= 0) {
      clearInterval(autoReturnInterval);
      closeModal();
      deactivatePriorityMode();
    }
  }, 1000);
  
  document.getElementById("btnNormal").onclick = () => {
    clearInterval(autoReturnInterval);
    closeModal();
    deactivatePriorityMode();
  };
  
  document.getElementById("btnProlonger").onclick = () => {
    clearInterval(autoReturnInterval);
    closeModal();
    prolongerPriorite(axis);
  };
}

function closeModal() {
  isModalOpen = false;
  document.getElementById("endPriorityModal").style.display = "none";
}

async function prolongerPriorite(axis) {
  priorityStatus.textContent = `Priorité ${axis}: Prolongée (60s)`;
  
  await set(ref(db, "/mode"), `priority_${axis}_green`);
  
  let timeLeft = 60;
  updateCountdown(timeLeft);
  
  countdownInterval = setInterval(async () => {
    if (!priorityMode) return;
    
    timeLeft--;
    updateCountdown(timeLeft);
    
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      openEndPriorityModal(axis);
    }
  }, 1000);
}

async function deactivatePriorityMode() {
  priorityMode = false;
  isModalOpen = false;
  const axis = priorityAxis;
  priorityAxis = null;
  
  if (countdownInterval) clearInterval(countdownInterval);
  if (autoReturnInterval) clearInterval(autoReturnInterval);
  
  // Réactiver l'autre bouton
  priorityBtnNS.disabled = false;
  priorityBtnOE.disabled = false;
  priorityBtnNS.style.opacity = "1";
  priorityBtnOE.style.opacity = "1";
  priorityBtnNS.textContent = "🚨 Priorité Nord-Sud";
  priorityBtnOE.textContent = "🚨 Priorité Ouest-Est";
  priorityBtnNS.classList.remove("active");
  priorityBtnOE.classList.remove("active");
  
  // Phase de transition : Orange sur les deux axes pendant 5s
  priorityStatus.textContent = "Transition: Orange général (5s)";
  countdownEl.textContent = "⏱️ 5s";
  
  await set(ref(db, "/mode"), "transition_orange");
  
  // Les deux feux passent à l'orange
  updateTrafficLight('feu1', 'orange');
  updateTrafficLight('feu2', 'orange');
  
  let transitionTime = 5;
  
  return new Promise((resolve) => {
    const transitionInterval = setInterval(async () => {
      transitionTime--;
      countdownEl.textContent = `⏱️ ${transitionTime}s`;
      
      if (transitionTime <= 0) {
        clearInterval(transitionInterval);
        
        // Retour au mode normal (Feu1 Rouge, Feu2 Vert pour reprendre le cycle)
        priorityStatus.textContent = "Mode Normal";
        priorityStatus.classList.remove("active");
        prioritySection.classList.remove("active");
        countdownEl.textContent = "";
        
        await set(ref(db, "/mode"), "normal");
        
        // Reprendre le cycle au feu1 rouge (qui passera à vert selon le cycle)
        currentPhase = 'feu2_orange'; // Force transition vers feu1_vert
        startAutoCycle();
        resolve();
      }
    }, 1000);
  });
}

function startBlinkingSequence(axis, duration, callback) {
  let timeLeft = duration;
  updateCountdown(timeLeft);
  
  const feuPrio = axis === 'NS' ? 'feu1' : 'feu2';
  const gpioBase = feuPrio === 'feu1' ? 1 : 4;
  
  let blinkState = false;
  blinkInterval = setInterval(() => {
    if (!priorityMode) {
      clearInterval(blinkInterval);
      return;
    }
    
    blinkState = !blinkState;
    // Vert + Orange clignotent ensemble sur le feu prioritaire
    set(ref(db, `/feu${feuPrio}/gpio${gpioBase}`), blinkState ? 1 : 0);     // Vert
    set(ref(db, `/feu${feuPrio}/gpio${gpioBase + 1}`), blinkState ? 1 : 0); // Orange
    set(ref(db, `/feu${feuPrio}/gpio${gpioBase + 2}`), 0);                  // Rouge éteint
    
    // Mise à jour UI manuelle pour le clignotement
    updateFeuUI(feuPrio, blinkState ? 'blink' : 'off');
    
  }, 2000); // 500ms = 1Hz
  
  countdownInterval = setInterval(() => {
    if (!priorityMode) {
      clearInterval(countdownInterval);
      clearInterval(blinkInterval);
      return;
    }
    
    timeLeft--;
    updateCountdown(timeLeft);
    
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      clearInterval(blinkInterval);
      if (callback) callback();
    }
  }, 1000);
}

function stopAllModes() {
  priorityMode = false;
  priorityAxis = null;
  if (countdownInterval) clearInterval(countdownInterval);
  if (blinkInterval) clearInterval(blinkInterval);
  if (autoCycleInterval) clearInterval(autoCycleInterval);
}

function updateCountdown(seconds) {
  if (seconds > 0) {
    countdownEl.textContent = `⏱️ ${seconds}s`;
  } else {
    countdownEl.textContent = "";
  }
}

// ========== ÉCOUTEURS ==========

function startListeners() {
  // Écoute des deux feux
  ['feu1', 'feu2'].forEach((feuId) => {
    const gpioBase = feuId === 'feu1' ? 1 : 4;
    
    // Vert
    onValue(ref(db, `/${feuId}/gpio${gpioBase}`), (snapshot) => {
      const val = snapshot.val() ? 1 : 0;
      if (val) updateFeuUI(feuId, 'green');
    });
    
    // Orange
    onValue(ref(db, `/${feuId}/gpio${gpioBase + 1}`), (snapshot) => {
      const val = snapshot.val() ? 1 : 0;
      if (val) updateFeuUI(feuId, 'orange');
    });
    
    // Rouge
    onValue(ref(db, `/${feuId}/gpio${gpioBase + 2}`), (snapshot) => {
      const val = snapshot.val() ? 1 : 0;
      if (val) updateFeuUI(feuId, 'red');
    });
  });
  
  // Écoute du mode
  onValue(ref(db, "/mode"), (snapshot) => {
    const mode = snapshot.val();
    console.log("Mode Firebase:", mode);
  });
}

function updateFeuUI(feuId, state) {
  const feu = feuId === 'feu1' ? feu1 : feu2;
  
  // Reset all
  feu.vert.classList.remove("on");
  feu.orange.classList.remove("on");
  feu.rouge.classList.remove("on");
  feu.labels.vert.classList.remove("on");
  feu.labels.orange.classList.remove("on");
  feu.labels.rouge.classList.remove("on");
  
  feu.labels.vert.textContent = "Éteint";
  feu.labels.orange.textContent = "Éteint";
  feu.labels.rouge.textContent = "Éteint";
  
  // Set active
  switch(state) {
    case 'green':
      feu.vert.classList.add("on");
      feu.labels.vert.textContent = "Allumé";
      feu.labels.vert.classList.add("on");
      break;
    case 'orange':
      feu.orange.classList.add("on");
      feu.labels.orange.textContent = "Allumé";
      feu.labels.orange.classList.add("on");
      break;
    case 'red':
      feu.rouge.classList.add("on");
      feu.labels.rouge.textContent = "Allumé";
      feu.labels.rouge.classList.add("on");
      break;
    case 'blink':
      // État spécial pour le clignotement (vert+orange)
      feu.vert.classList.add("on");
      feu.orange.classList.add("on");
      feu.labels.vert.textContent = "Clignote";
      feu.labels.orange.textContent = "Clignote";
      break;
    case 'off':
      // Tout éteint
      break;
  }
}