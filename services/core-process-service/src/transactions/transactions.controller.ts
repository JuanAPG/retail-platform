import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { TransactionsService, ArchivoSubido } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionFilterDto } from './dto/transaction-filter.dto';
import { ConfirmCsvImportDto } from './dto/confirm-csv-import.dto';

/**
 * M06 — Transacciones e importación CSV.
 *
 * Primer eslabón de la cadena: cada transacción guardada construye su
 * canasta de inmediato (M07) vía `BasketsService.buildFromTransaction()`.
 * La validación de tiendas/productos se hace contra catalog-service por
 * HTTP (este servicio no es dueño del catálogo): si no responde, 503 y
 * no se inserta nada.
 */
@ApiTags('v1 Transactions')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiRespuesta(201, 'Transacción creada con su canasta.', muestras.transaccion)
  @ApiErrores(400, 401, 403, 404, 409, 503)
  createManual(
    @Body() dto: CreateTransactionDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ) {
    return this.transactionsService.createManual(dto, usuario, token, ip);
  }

  @Post('import/preview')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiRespuesta(201, 'Preview validado (nada insertado todavía).', muestras.previewCsv)
  @ApiErrores(400, 401, 403, 409, 413, 503)
  previewCsvImport(
    @UploadedFile() file: ArchivoSubido,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.transactionsService.previewCsvImport(file, usuario, token);
  }

  @Post('import/confirm')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiRespuesta(200, 'Importación confirmada con resumen.', muestras.confirmCsv)
  @ApiErrores(400, 401, 403, 404, 409)
  confirmCsvImport(
    @Body() dto: ConfirmCsvImportDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
  ) {
    return this.transactionsService.confirmCsvImport(dto.previewId, usuario, ip);
  }

  @Get('import/pending')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiRespuesta(200, 'Importaciones por confirmar.', [])
  @ApiErrores(401, 403)
  pendingImports() {
    return this.transactionsService.listPendingImports();
  }

  @Get()
  @Roles(...PERFILES_INTERNOS)
  @ApiRespuesta(200, 'Transacciones con filtros.', [muestras.transaccion])
  @ApiErrores(401, 403)
  findAll(@Query() filters: TransactionFilterDto) {
    return this.transactionsService.findAll(filters);
  }

  @Get(':id')
  @Roles(...PERFILES_INTERNOS)
  @ApiRespuesta(200, 'Transacción con detalle.', muestras.transaccion)
  @ApiErrores(401, 403, 404)
  findOne(@Param('id') id: string) {
    return this.transactionsService.findOne(id);
  }
}
