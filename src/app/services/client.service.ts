import { Injectable } from '@angular/core';
import { Firestore, collection, doc, setDoc, addDoc, deleteDoc, query, orderBy, onSnapshot, getDoc } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Client } from '../models/client.model';

@Injectable({
  providedIn: 'root'
})
export class ClientService {
  private collectionName = 'clients';

  constructor(private firestore: Firestore) {}

  getClients(): Observable<Client[]> {
    const clientsRef = collection(this.firestore, this.collectionName);
    const q = query(clientsRef, orderBy('name', 'asc'));
    
    return new Observable<Client[]>(observer => {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Client[];
        observer.next(data);
      }, error => {
        observer.error(error);
      });
      return () => unsubscribe();
    });
  }

  async addClient(client: Client): Promise<string> {
    const clientsRef = collection(this.firestore, this.collectionName);
    const docRef = await addDoc(clientsRef, client);
    return docRef.id;
  }

  async getClientById(id: string): Promise<Client | undefined> {
    const docRef = doc(this.firestore, this.collectionName, id);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() } as Client;
    }
    return undefined;
  }

  async updateClient(id: string, data: Partial<Client>): Promise<void> {
    const docRef = doc(this.firestore, this.collectionName, id);
    return setDoc(docRef, data, { merge: true });
  }

  async deleteClient(id: string): Promise<void> {
    const docRef = doc(this.firestore, this.collectionName, id);
    return deleteDoc(docRef);
  }
}
