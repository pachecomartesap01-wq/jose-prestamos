export interface PropertyPayment {
  id?: string;
  date: Date | any; // Firebase timestamp
  amount: number;
  notes?: string;
}

export interface Property {
  id?: string;
  address: string;
  description?: string;
  rentAmount: number;
  status: 'available' | 'rented';
  tenantId?: string | null;
  payments: PropertyPayment[];
  createdAt: Date | any;
}
