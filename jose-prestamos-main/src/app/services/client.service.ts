import { Injectable } from '@angular/core';
import { Firestore, collection, doc, setDoc, addDoc, onSnapshot, getDoc, getDocsFromServer, query, where, runTransaction } from '@angular/fire/firestore';
import { map, Observable, shareReplay } from 'rxjs';
import { Client } from '../models/client.model';
import { CollectionSnapshot } from '../models/collection-snapshot.model';

@Injectable({
  providedIn: 'root'
})
export class ClientService {
  private collectionName = 'clients';
  private clientsSnapshot$?: Observable<CollectionSnapshot<Client>>;

  constructor(private firestore: Firestore) {}

  getClients(): Observable<Client[]> {
    return this.getClientsSnapshot().pipe(map(snapshot => snapshot.data));
  }

  getClientsSnapshot(): Observable<CollectionSnapshot<Client>> {
    if (this.clientsSnapshot$) return this.clientsSnapshot$;

    const clientsRef = collection(this.firestore, this.collectionName);
    this.clientsSnapshot$ = new Observable<CollectionSnapshot<Client>>(observer => {
      const unsubscribe = onSnapshot(clientsRef, { includeMetadataChanges: true }, snapshot => {
        const data = snapshot.docs
          .map(d => ({ ...d.data(), id: d.id }) as Client)
          .sort((a, b) =>
            String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es') ||
            String(a.id).localeCompare(String(b.id))
          );
        observer.next({
          data,
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites
        });
      }, error => observer.error(error));
      return unsubscribe;
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    return this.clientsSnapshot$;
  }

  async addClient(client: Client): Promise<string> {
    const clientsRef = collection(this.firestore, this.collectionName);
    const docRef = await addDoc(clientsRef, client);
    return docRef.id;
  }

  async isDocumentIdInUse(documentId: string, exceptId?: string): Promise<boolean> {
    const clientsRef = collection(this.firestore, this.collectionName);
    const snapshot = await getDocsFromServer(clientsRef);
    const normalizedId = this.normalizeDocumentId(documentId);
    return snapshot.docs.some(client =>
      client.id !== exceptId &&
      this.normalizeDocumentId(String(client.data()['documentId'] ?? '')) === normalizedId
    );
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
    const loansRef = collection(this.firestore, 'loans');
    const linkedLoans = await getDocsFromServer(query(loansRef, where('clientId', '==', id)));
    if (!linkedLoans.empty) {
      throw new Error('No se puede eliminar un cliente que tiene préstamos registrados. Conserva su expediente para mantener el historial.');
    }
    await runTransaction(this.firestore, async transaction => {
      const client = await transaction.get(docRef);
      if (!client.exists()) return;
      transaction.delete(docRef);
    });
  }

  private normalizeDocumentId(value: string): string {
    return value.toLocaleUpperCase().replace(/[^A-Z0-9]/g, '');
  }
}
