export interface Client {
  id?: string;
  name: string;
  documentId: string; // Cédula
  birthDate?: Date;
  gender?: string; // Sexo
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  occupation?: string;
  company?: string;
  createdAt: Date;
}
