// js/firebase-core.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyDAnwh1kYnomfGIMM71J9tCY3tuOV0ejnE",
    authDomain: "chat-app-356c1.firebaseapp.com",
    databaseURL: "https://chat-app-356c1-default-rtdb.firebaseio.com",
    projectId: "chat-app-356c1",
    storageBucket: "chat-app-356c1.firebasestorage.app",
    messagingSenderId: "327658376387",
    appId: "1:327658376387:web:4a47e25dc8156afb7de676",
    measurementId: "G-M3DPZWT9LD"
};

const app = initializeApp(firebaseConfig);

// EXPORT these so other modules can use them!
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);