import { Injectable } from '@angular/core';
import { Firestore, collection, doc, setDoc, addDoc, deleteDoc, getDoc, query, where, getDocs, writeBatch, orderBy, onSnapshot } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Loan, Installment } from '../models/loan.model';

@Injectable({
  providedIn: 'root'
})
export class LoanService {
  private collectionName = 'loans';

  constructor(private firestore: Firestore) {}

  async getLoanById(id: string): Promise<Loan | undefined> {
    const docRef = doc(this.firestore, this.collectionName, id);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() } as Loan;
    }
    return undefined;
  }

  getLoans(): Observable<Loan[]> {
    const loansRef = collection(this.firestore, this.collectionName);
    const q = query(loansRef, orderBy('startDate', 'desc'));
    
    return new Observable<Loan[]>(observer => {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Loan[];
        observer.next(data);
      }, error => {
        observer.error(error);
      });
      return () => unsubscribe();
    });
  }

  getLoansByClient(clientId: string): Observable<Loan[]> {
    const loansRef = collection(this.firestore, this.collectionName);
    const q = query(loansRef, where('clientId', '==', clientId));
    
    return new Observable<Loan[]>(observer => {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Loan[];
        observer.next(data);
      }, error => {
        observer.error(error);
      });
      return () => unsubscribe();
    });
  }

  async updateLoan(id: string, data: Partial<Loan>): Promise<void> {
    const docRef = doc(this.firestore, this.collectionName, id);
    return setDoc(docRef, data, { merge: true });
  }

  async deleteLoan(id: string): Promise<void> {
    const docRef = doc(this.firestore, this.collectionName, id);
    return deleteDoc(docRef);
  }

  async createLoan(loan: Loan): Promise<string> {
    const loansRef = collection(this.firestore, this.collectionName);
    
    // Generate installments
    loan.installments = this.calculateInstallments(loan.amount, loan.interestRate, loan.duration, loan.paymentFrequency, loan.startDate);
    
    const docRef = await addDoc(loansRef, loan);
    return docRef.id;
  }

  public calculateInstallments(amount: number, rate: number, duration: number, frequency: string, startDate: Date): Installment[] {
    const installments: Installment[] = [];
    // Simple Interest Calculation
    const totalInterest = amount * (rate / 100);
    const totalAmount = amount + totalInterest;
    const amountPerInstallment = totalAmount / duration;
    
    let currentDate = new Date(startDate);
    
    for (let i = 1; i <= duration; i++) {
      // Calculate next due date based on frequency
      if (frequency === 'daily') {
        currentDate.setDate(currentDate.getDate() + 1);
      } else if (frequency === 'weekly') {
        currentDate.setDate(currentDate.getDate() + 7);
      } else if (frequency === 'biweekly') {
        currentDate.setDate(currentDate.getDate() + 15);
      } else if (frequency === 'monthly') {
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
      
      installments.push({
        loanId: '', // Will be assigned later if storing in subcollection, but here it's embedded
        dueDate: new Date(currentDate),
        amount: amountPerInstallment,
        isPaid: false
      });
    }
    
    return installments;
  }
}
