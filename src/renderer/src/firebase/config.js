// Firebase configuration for KidsControlPC
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyAFYWqbatuvU0qQOpe7cphvVwN7_hSeui0",
  authDomain: "kidscontrolpc.firebaseapp.com",
  projectId: "kidscontrolpc",
  storageBucket: "kidscontrolpc.firebasestorage.app",
  messagingSenderId: "415574988307",
  appId: "1:415574988307:web:a85c12d2881cff0c4111e6",
  measurementId: "G-QND5RJ7JPH"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
export default app
