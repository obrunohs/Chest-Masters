import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  query,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { firebaseConfig, ADMIN_EMAIL } from "./firebase-config.js";
import { chestData } from "./game-data.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

function showAdminLogin() {
  $("adminLogin").style.display = "flex";
  $("adminPanel").style.display = "none";
}

function showAdminPanel() {
  $("adminLogin").style.display = "none";
  $("adminPanel").style.display = "block";
  listenEventStatus();
  listenPlayers();
}

function isAdminUser(user) {
  return user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

window.adminLogin = async function () {
  const email = $("adminEmail").value.trim().toLowerCase();
  const password = $("adminPassword").value.trim();

  if (email !== ADMIN_EMAIL.toLowerCase()) {
    alert("Este email não é o admin autorizado.");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    alert("Erro no login admin: " + err.message);
  }
};

window.adminLogout = async function () {
  await signOut(auth);
  showAdminLogin();
};

window.startChestEvent = async function () {
  if (!isAdminUser(auth.currentUser)) return alert("Acesso negado.");

  const chestType = $("eventChestType").value;
  const seconds = Math.max(1, Number($("dropSeconds").value || 2));

  await setDoc(doc(db, "gameControl", "event"), {
    active: true,
    chestType,
    seconds,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.email
  });

  alert("Evento iniciado.");
};

window.stopChestEvent = async function () {
  if (!isAdminUser(auth.currentUser)) return alert("Acesso negado.");

  await setDoc(doc(db, "gameControl", "event"), {
    active: false,
    chestType: $("eventChestType").value,
    seconds: Math.max(1, Number($("dropSeconds").value || 2)),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.email
  });

  alert("Evento parado.");
};

window.broadcastMessage = async function () {
  if (!isAdminUser(auth.currentUser)) return alert("Acesso negado.");

  const text = $("broadcastText").value.trim();
  if (!text) return alert("Digite uma mensagem.");

  await setDoc(doc(db, "gameControl", "message"), {
    id: Date.now(),
    text,
    entrance: $("messageEntrance").value,
    style: $("messageStyle").value,
    duration: Math.max(1, Number($("messageDuration").value || 6)),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.email
  });

  alert("Mensagem enviada.");
};

function listenEventStatus() {
  onSnapshot(doc(db, "gameControl", "event"), snap => {
    const event = snap.data();
    const box = $("eventStatus");

    if (!event || !event.active) {
      box.innerHTML = "Evento parado.";
      return;
    }

    $("eventChestType").value = event.chestType || "madeira";
    $("dropSeconds").value = event.seconds || 2;

    box.innerHTML = `
      Evento ativo<br>
      Baú: <b>${chestData[event.chestType]?.name || "Baú de Madeira"}</b><br>
      Intervalo: <b>${event.seconds} segundos</b><br>
      Regra: cada player só recebe outro baú quando quebrar o atual.
    `;
  });
}

function listenPlayers() {
  const q = query(collection(db, "players"), limit(30));

  onSnapshot(q, snap => {
    const box = $("playersList");

    if (snap.empty) {
      box.innerHTML = "Nenhum jogador cadastrado ainda.";
      return;
    }

    box.innerHTML = "";
    snap.forEach(docSnap => {
      const p = docSnap.data();
      box.innerHTML += `
        <b>${p.name || "Sem nome"}</b><br>
        Email: ${p.email}<br>
        Cargo: ${p.role || "player"}<br>
        Cartas: ${p.cards?.length || 0}/10<br><br>
      `;
    });
  });
}

onAuthStateChanged(auth, user => {
  if (isAdminUser(user)) {
    showAdminPanel();
  } else {
    if (user) signOut(auth);
    showAdminLogin();
  }
});
