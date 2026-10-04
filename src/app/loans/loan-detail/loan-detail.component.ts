import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { LoanService } from '../../services/loan.service';
import { ClientService } from '../../services/client.service';
import { Observable, BehaviorSubject, switchMap, map, tap } from 'rxjs';
import { Loan, Installment } from '../../models/loan.model';

@Component({
  selector: 'app-loan-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './loan-detail.component.html',
  styleUrl: './loan-detail.component.css'
})
export class LoanDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private loanService = inject(LoanService);
  private clientService = inject(ClientService);

  loan$: Observable<any> | undefined;

  ngOnInit() {
    this.loan$ = this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        // Simple way to get single loan: get all and filter (for now, ideal is getDoc)
        return this.loanService.getLoans().pipe(
          map(loans => loans.find(l => l.id === id))
        );
      }),
      switchMap(loan => {
        if (!loan) return [null];
        return this.clientService.getClients().pipe(
          map(clients => {
            const client = clients.find(c => c.id === loan.clientId);
            
            // Convertir fechas de Firebase a objetos Date de JS para que Angular DatePipe no falle
            let parsedStartDate = loan.startDate;
            if (loan.startDate && (loan.startDate as any).toDate) {
              parsedStartDate = (loan.startDate as any).toDate();
            } else if (typeof loan.startDate === 'string' || typeof loan.startDate === 'number') {
              parsedStartDate = new Date(loan.startDate);
            }

            const parsedInstallments = (loan.installments || []).map((inst: any) => {
              let dDate = inst.dueDate;
              if (inst.dueDate && (inst.dueDate as any).toDate) {
                dDate = (inst.dueDate as any).toDate();
              } else if (typeof inst.dueDate === 'string' || typeof inst.dueDate === 'number') {
                dDate = new Date(inst.dueDate);
              }
              return { ...inst, dueDate: dDate };
            });

            return {
              ...loan,
              startDate: parsedStartDate,
              installments: parsedInstallments,
              clientName: client ? client.name : 'Desconocido',
              clientPhone: client ? client.phone : ''
            };
          })
        );
      })
    );
  }

  async toggleInstallmentStatus(loan: any, index: number) {
    if (!loan || !loan.installments) return;
    
    const updatedInstallments = [...loan.installments];
    const installment = updatedInstallments[index];
    
    installment.isPaid = !installment.isPaid;
    if (installment.isPaid) {
      installment.paidDate = new Date();
      installment.paidAmount = installment.amount;
    } else {
      installment.paidDate = undefined;
      installment.paidAmount = 0;
    }
    
    try {
      await this.loanService.updateLoan(loan.id, { installments: updatedInstallments });
    } catch (e) {
      console.error("Error al actualizar cuota", e);
      alert("Error al guardar el pago");
    }
  }

  async deleteLoan(id: string) {
    if (confirm('¿Estás seguro de que deseas eliminar este préstamo permanentemente?')) {
      try {
        await this.loanService.deleteLoan(id);
        this.router.navigate(['/loans']);
      } catch (e) {
        console.error("Error al eliminar", e);
        alert("Ocurrió un error al eliminar el préstamo.");
      }
    }
  }

  async registerAbono(loan: any, index: number) {
    if (!loan || !loan.installments) return;
    
    const installment = loan.installments[index];
    if (installment.isPaid) return;

    const currentPaid = installment.paidAmount || 0;
    const remaining = installment.amount - currentPaid;

    const input = prompt(`La cuota es de $${installment.amount.toFixed(2)}.\nFalta pagar $${remaining.toFixed(2)}.\n\n¿Cuánto abonará el cliente ahora?`);
    if (input === null || input.trim() === '') return;

    const amount = Number(input);
    if (isNaN(amount) || amount <= 0) {
      alert("Por favor ingresa un monto válido mayor a 0.");
      return;
    }

    const updatedInstallments = [...loan.installments];
    const updatedInstallment = updatedInstallments[index];

    const newTotalPaid = currentPaid + amount;

    if (newTotalPaid >= updatedInstallment.amount) {
      updatedInstallment.isPaid = true;
      updatedInstallment.paidAmount = updatedInstallment.amount;
      updatedInstallment.paidDate = new Date();
      alert("¡El abono cubre el total de la cuota! Se marcará como pagada.");
    } else {
      updatedInstallment.paidAmount = newTotalPaid;
    }

    try {
      await this.loanService.updateLoan(loan.id, { installments: updatedInstallments });
    } catch (e) {
      console.error("Error al actualizar cuota", e);
      alert("Error al guardar el abono");
    }
  }

  async registerAbonoCapital(loan: any) {
    if (!loan || !loan.installments) return;
    
    const unpaidIndices = loan.installments
      .map((inst: any, index: number) => ({ inst, index }))
      .filter((item: any) => !item.inst.isPaid);

    if (unpaidIndices.length === 0) {
      alert("No hay cuotas pendientes para abonar a capital.");
      return;
    }

    const currentTotalPending = unpaidIndices.reduce((sum: number, item: any) => {
      const remaining = item.inst.amount - (item.inst.paidAmount || 0);
      return sum + remaining;
    }, 0);

    const input = prompt(`El total pendiente de las ${unpaidIndices.length} cuotas restantes es $${currentTotalPending.toFixed(2)}.\n\n¿De cuánto será el Abono Extraordinario a Capital?`);
    if (input === null || input.trim() === '') return;

    const amount = Number(input);
    if (isNaN(amount) || amount <= 0) {
      alert("Por favor ingresa un monto válido mayor a 0.");
      return;
    }

    if (amount >= currentTotalPending) {
      alert("El abono es igual o mayor a la deuda total. Mejor usa los botones de 'Cobrar Todo' en las cuotas para saldar el préstamo.");
      return;
    }

    const deductionPerInstallment = amount / unpaidIndices.length;
    const updatedInstallments = [...loan.installments];
    
    for (const item of unpaidIndices) {
      const idx = item.index;
      updatedInstallments[idx].amount = Math.max(0, updatedInstallments[idx].amount - deductionPerInstallment);
      
      if (updatedInstallments[idx].paidAmount && updatedInstallments[idx].paidAmount >= updatedInstallments[idx].amount) {
         updatedInstallments[idx].isPaid = true;
         updatedInstallments[idx].paidDate = new Date();
         updatedInstallments[idx].paidAmount = updatedInstallments[idx].amount;
      }
    }

    try {
      await this.loanService.updateLoan(loan.id, { installments: updatedInstallments });
      alert("Abono a capital registrado exitosamente. Las cuotas futuras han disminuido.");
    } catch (e) {
      console.error("Error al registrar abono a capital", e);
      alert("Error al guardar el abono a capital");
    }
  }
}
