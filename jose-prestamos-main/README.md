# PrestamosApp

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 18.2.21.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Caja e historial de cobros

El acceso local de demostración para caja es `cajaadmin` / `cajaadmin`. Puede consultar clientes y préstamos y registrar pagos de cuotas; cada cobro confirmado genera un comprobante PDF descargable y compartible por WhatsApp. El historial registra fecha, cliente, préstamo, cuota, monto, método de pago, usuario y rol. Se consulta en páginas de 50 movimientos y se pueden filtrar por texto, tipo y fecha. Los filtros abarcan los registros ya cargados; carga páginas anteriores para buscar en períodos más antiguos. Los movimientos existentes antes de habilitar el historial no se importan.

En navegadores compatibles, “Enviar por WhatsApp” comparte el PDF mediante el menú nativo de compartir. En otros navegadores descarga el PDF y abre WhatsApp con el detalle para que se adjunte manualmente. El documento se identifica como comprobante informativo, no como factura fiscal.

Este acceso y sus permisos viven en el cliente web y no protegen los datos de Firestore frente a una persona que manipule el navegador. Antes de usarlo como control de acceso real o para operación financiera, configura Firebase Authentication y reglas de Firestore que autoricen cada rol en el servidor.

## Cálculo y conservación de préstamos

Los préstamos amortizados nuevos calculan intereses sobre el saldo de capital pendiente. El sistema genera cuotas en centavos, conserva el desglose de capital e interés y ajusta la última cuota por redondeo. Los préstamos ya guardados sin el campo `interestMethod` conservan sus cuotas y su cálculo fijo original; no se migran ni se recalculan automáticamente.

Un abono extraordinario a un préstamo de saldo decreciente reduce el capital y recalcula las cuotas pendientes. Los pagos parciales que existían antes del recálculo permanecen en el historial y el nuevo calendario parte del saldo remanente. No se permite editar el calendario de un préstamo con movimientos registrados ni eliminar préstamos/clientes que tengan historial o relaciones.

Las cuotas vencidas se detectan por fecha y saldo pendiente y se muestran en el dashboard y los filtros de préstamos. La aplicación no calcula multas, intereses moratorios ni declara automáticamente un préstamo en incumplimiento; esas políticas requieren definición del negocio.

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
