import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, addDoc, updateDoc, deleteDoc, onSnapshot } from '@angular/fire/firestore';
import { Observable, shareReplay } from 'rxjs';
import { Property, PropertyPayment } from '../models/property.model';

@Injectable({
  providedIn: 'root'
})
export class PropertyService {
  private firestore = inject(Firestore);
  private collectionName = 'properties';
  private properties$?: Observable<Property[]>;

  getProperties(): Observable<Property[]> {
    if (this.properties$) return this.properties$;

    const propertiesRef = collection(this.firestore, this.collectionName);
    this.properties$ = new Observable<Property[]>(observer => {
      const unsubscribe = onSnapshot(propertiesRef, snapshot => {
        const data = snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as Property[];
        observer.next(data);
      }, error => observer.error(error));
      return unsubscribe;
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    return this.properties$;
  }

  createProperty(property: Property): Promise<any> {
    const propertiesRef = collection(this.firestore, this.collectionName);
    return addDoc(propertiesRef, property);
  }

  updateProperty(id: string, data: Partial<Property>): Promise<void> {
    const propertyDocRef = doc(this.firestore, `${this.collectionName}/${id}`);
    return updateDoc(propertyDocRef, data);
  }

  deleteProperty(id: string): Promise<void> {
    const propertyDocRef = doc(this.firestore, `${this.collectionName}/${id}`);
    return deleteDoc(propertyDocRef);
  }

  addPayment(propertyId: string, payments: PropertyPayment[]): Promise<void> {
    const propertyDocRef = doc(this.firestore, `${this.collectionName}/${propertyId}`);
    return updateDoc(propertyDocRef, { payments });
  }
}
