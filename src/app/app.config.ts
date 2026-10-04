import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD3IAs7OquOym9kuWE290Tu7VevWgZfdTE",
  authDomain: "jose-prestamos.firebaseapp.com",
  projectId: "jose-prestamos",
  storageBucket: "jose-prestamos.firebasestorage.app",
  messagingSenderId: "628651748575",
  appId: "1:628651748575:web:3c804cbd834524dd884d6a",
  measurementId: "G-P3Z83DWL2J"
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    provideRouter(routes),
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideFirestore(() => getFirestore())
  ]
};
