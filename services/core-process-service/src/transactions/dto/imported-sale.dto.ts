import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto';

export class ImportedSaleDto extends CreateTransactionDto {
  @ApiProperty({ format: 'uuid', description: 'Lote de origen en transactions-ingestion-service.' })
  @IsUUID('4')
  batchId: string;
}
