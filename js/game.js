import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { hammerData, chestData, cardPool } from "./game-data.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let playerData = null;
let activeChest = null;
let eventTimer = null;
let lastDropAt = 0;
let lastMessageId = null;

const $ = id => document.getElementById(id);

window.showScreen = function (id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $("game").style.display = "none";
  $(id).classList.add("active");
};

function toast(msg) {
  const t = $("toast");
  t.innerText = msg;
  t.style.display = "block";
  setTimeout(() => t.style.display = "none", 3000);
}

async function ensurePlayerDoc(user, name = "") {
  const ref = doc(db, "players", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      name: name || user.email.split("@")[0],
      email: user.email,
      role: "player",
      ownedHammers: ["madeira"],
      selectedHammer: "madeira",
      cards: [],
      createdAt: serverTimestamp()
    });
  }

  const updated = await getDoc(ref);
  playerData = updated.data();
}

window.registerAccount = async function () {
  const name = $("regName").value.trim();
  const email = $("regEmail").value.trim().toLowerCase();
  const password = $("regPassword").value.trim();

  if (!name || !email || !password) {
    alert("Preencha todos os campos.");
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // No cadastro, criamos apenas o usuário no Authentication
    // e enviamos o email de confirmação.
    // O perfil no Firestore será criado depois, no primeiro login confirmado.
    sessionStorage.setItem("pendingPlayerName", name);

    await sendEmailVerification(cred.user);
    await signOut(auth);

    window.showScreen("loginScreen");
    alert("Conta criada. Confirme o email antes de entrar. Depois volte e faça login.");
  } catch (err) {
    alert("Erro ao cadastrar: " + err.message);
  }
};

window.login = async function () {
  const email = $("loginEmail").value.trim().toLowerCase();
  const password = $("loginPassword").value.trim();

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);

    if (!cred.user.emailVerified) {
      await signOut(auth);
      alert("Confirme seu email antes de entrar.");
      return;
    }

    await cred.user.getIdToken(true);

    const pendingName = sessionStorage.getItem("pendingPlayerName") || "";
    await ensurePlayerDoc(cred.user, pendingName);
    sessionStorage.removeItem("pendingPlayerName");

    startGame();
  } catch (err) {
    alert("Erro ao entrar: " + err.message);
  }
};

window.recoverPassword = async function () {
  const email = prompt("Digite seu email:");
  if (!email) return;

  try {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
    alert("Email de recuperação enviado.");
  } catch (err) {
    alert("Erro: " + err.message);
  }
};

window.playerLogout = async function () {
  await signOut(auth);
  location.reload();
};

function startGame() {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $("game").style.display = "block";
  renderHUD();
  renderShop();
  renderCollection();
  listenToEvents();
  listenToMessages();
}

function renderHUD() {
  const hammer = hammerData[playerData.selectedHammer];
  $("hudName").innerText = playerData.name;
  $("hudHammer").innerText = hammer.name;
  $("hudCards").innerText = playerData.cards.length;
  $("hammerCursor").innerText = hammer.emoji;
}

function renderShop() {
  const shop = $("shopItems");
  shop.innerHTML = "";

  Object.entries(hammerData).forEach(([id, hammer]) => {
    const owned = playerData.ownedHammers.includes(id);
    const selected = playerData.selectedHammer === id;

    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <b>${hammer.emoji} Martelo de ${hammer.name}</b><br>
      Dano: ${hammer.damage}<br>
      Preço: ${hammer.price === 0 ? "Grátis" : "R$ " + hammer.price + ",00 via Pix"}
      <button ${selected ? "disabled" : ""} onclick="${owned ? `selectHammer('${id}')` : `buyHammer('${id}')`}">
        ${selected ? "Selecionado" : owned ? "Usar" : "Comprar"}
      </button>
    `;
    shop.appendChild(div);
  });
}

window.buyHammer = async function (id) {
  const hammer = hammerData[id];

  if (hammer.price > 0) {
    alert("Compra real via Pix ainda será ligada por Cloud Functions ou outro backend seguro. Neste protótipo online, a compra paga fica bloqueada.");
    return;
  }

  await selectHammer(id);
};

window.selectHammer = async function (id) {
  if (!playerData.ownedHammers.includes(id)) return;

  playerData.selectedHammer = id;
  await updateDoc(doc(db, "players", auth.currentUser.uid), {
    selectedHammer: id
  });

  renderHUD();
  renderShop();
};

function listenToEvents() {
  onSnapshot(doc(db, "gameControl", "event"), snap => {
    const event = snap.data();
    if (!event || !event.active) {
      if (eventTimer) clearInterval(eventTimer);
      eventTimer = null;
      return;
    }

    if (eventTimer) clearInterval(eventTimer);

    eventTimer = setInterval(() => {
      if (activeChest) return;

      const seconds = Math.max(1, Number(event.seconds || 2));
      if (Date.now() - lastDropAt < seconds * 1000) return;

      lastDropAt = Date.now();
      spawnChest(event.chestType || "madeira");
    }, 250);
  });
}

function spawnChest(type) {
  const data = chestData[type];
  activeChest = { type, hp: data.hp, maxHp: data.hp };
  $("chestEmoji").innerText = data.emoji;
  $("chest").style.display = "block";
  updateChestBar();
  toast(data.name + " apareceu!");
}

function updateChestBar() {
  const p = Math.max(0, activeChest.hp / activeChest.maxHp * 100);
  $("chestHealthFill").style.width = p + "%";
}

function animateHammerHit() {
  const h = $("hammerCursor");
  h.classList.remove("hit");
  void h.offsetWidth;
  h.classList.add("hit");
}

window.hitChest = function () {
  if (!activeChest) return;

  animateHammerHit();

  activeChest.hp -= hammerData[playerData.selectedHammer].damage;
  updateChestBar();

  const chestEl = $("chest");
  chestEl.style.transform = "translate(-50%,-50%) scale(.92) rotate(-2deg)";
  setTimeout(() => chestEl.style.transform = "translate(-50%,-50%) scale(1)", 90);

  if (activeChest.hp <= 0) {
    openChest(activeChest.type);
    activeChest = null;
    $("chest").style.display = "none";
  }
};

async function openChest(type) {
  if (Math.random() < .55) {
    toast("O baú estava vazio.");
    return;
  }

  const pool = cardPool[type];
  const card = pool[Math.floor(Math.random() * pool.length)];

  if (playerData.cards.includes(card)) {
    toast("Carta repetida: " + card);
    return;
  }

  if (playerData.cards.length >= 10) {
    toast("Limite de 10 cartas cheio.");
    return;
  }

  playerData.cards.push(card);

  await updateDoc(doc(db, "players", auth.currentUser.uid), {
    cards: playerData.cards
  });

  renderHUD();
  renderCollection();
  toast("Nova carta: " + card);
}

function renderCollection() {
  const c = $("cardsContainer");
  c.innerHTML = "";

  for (let i = 0; i < 10; i++) {
    const div = document.createElement("div");
    div.className = "cardSlot" + (playerData.cards[i] ? "" : " emptySlot");
    div.innerText = playerData.cards[i] || "Vazio";
    c.appendChild(div);
  }
}

function listenToMessages() {
  onSnapshot(doc(db, "gameControl", "message"), snap => {
    const msg = snap.data();
    if (!msg || !msg.id || msg.id === lastMessageId) return;
    showGlobalMessage(msg);
  });
}

function showGlobalMessage(msg) {
  lastMessageId = msg.id;
  const box = $("globalMessage");
  box.className = "";
  box.innerText = msg.text;
  box.style.display = "flex";
  box.classList.add(msg.entrance || "slideRight", msg.style || "glow");

  setTimeout(() => {
    box.style.display = "none";
    box.className = "";
  }, (msg.duration || 6) * 1000);
}

document.addEventListener("mousemove", e => {
  const cursor = $("hammerCursor");
  cursor.style.left = e.clientX + "px";
  cursor.style.top = e.clientY + "px";
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.showScreen("loginScreen");
    return;
  }

  if (!user.emailVerified) {
    await signOut(auth);
    window.showScreen("loginScreen");
    return;
  }

  const pendingName = sessionStorage.getItem("pendingPlayerName") || "";
  await ensurePlayerDoc(user, pendingName);
  sessionStorage.removeItem("pendingPlayerName");

  startGame();
});
