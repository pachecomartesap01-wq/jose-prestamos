import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, addDoc, updateDoc, deleteDoc, onSnapshot } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Property, PropertyPayment } from '../models/property.model';

@Injectable({
  providedIn: 'root'
})
export class PropertyService {
  private firestore = inject(Firestore);
  private collectionName = 'properties';

  getProperties(): Observable<Property[]> {
    const propertiesRef = collection(this.firestore, this.collectionName);
    return new Observable<Property[]>(observer => {
      const unsubscribe = onSnapshot(propertiesRef, (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Property[];
        observer.next(data);
      }, error => {
        observer.error(error);
      });
      return () => unsubscribe();
    });
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
