import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERFILES_INTERNOS, ROL, UsuarioSolicitante } from '../common/roles';
import { TransactionsService, ArchivoSubido } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionFilterDto } from './dto/transaction-filter.dto';
import { ConfirmCsvImportDto } from './dto/confirm-csv-import.dto';

/**
 * M06 — Transacciones e importación CSV (Juan Angel).
 *
 * Primer eslabón de la cadena: cada transacción guardada construye su
 * canasta de inmediato (M07) vía `BasketsService.buildFromTransaction()`.
 */
@ApiTags('M06 Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  createManual(
    @Body() dto: CreateTransactionDto,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.transactionsService.createManual(dto, usuario);
  }

  @Post('import/preview')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  previewCsvImport(
    @UploadedFile() file: ArchivoSubido,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.transactionsService.previewCsvImport(file, usuario);
  }

  @Post('import/confirm')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  confirmCsvImport(
    @Body() dto: ConfirmCsvImportDto,
    @CurrentUser() usuario: UsuarioSolicitante,
  ) {
    return this.transactionsService.confirmCsvImport(dto.previewId, usuario);
  }

  @Get()
  @Roles(...PERFILES_INTERNOS)
  findAll(@Query() filters: TransactionFilterDto) {
    return this.transactionsService.findAll(filters);
  }

  @Get(':id')
  @Roles(...PERFILES_INTERNOS)
  findOne(@Param('id') id: string) {
    return this.transactionsService.findOne(id);
  }
}
