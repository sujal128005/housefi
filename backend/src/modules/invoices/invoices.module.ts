import { Module } from '@nestjs/common';
import { InvoiceLinkController, InvoicePdfController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({ controllers: [InvoiceLinkController, InvoicePdfController], providers: [InvoicesService], exports: [InvoicesService] })
export class InvoicesModule {}
