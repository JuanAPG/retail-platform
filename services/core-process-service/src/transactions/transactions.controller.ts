import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { TransactionsService, ArchivoSubido } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionFilterDto } from './dto/transaction-filter.dto';
import { ConfirmCsvImportDto } from './dto/confirm-csv-import.dto';

/** 5 MB, el mismo tope que valida el servicio. */
const MAX_ARCHIVO_BYTES = 5 * 1024 * 1024;

/**
 * M06 — Transacciones e importación CSV.
 *
 * Primer eslabón de la cadena: cada transacción guardada construye su
 * canasta en la misma transacción de base de datos (M07, RN-03).
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
  @ApiOperation({
    summary: 'Registra una transacción manual y construye su canasta.',
    description:
      'Valida tienda, presentaciones y estatus del producto contra catalog-service. ' +
      '`total` se calcula del detalle (no se acepta del cliente) y se verifica contra ' +
      'la suma de los subtotales antes de confirmar la transacción de base de datos.',
  })
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
  @ApiOperation({
    summary: 'Paso 1 de la importación: valida el CSV y devuelve el preview.',
    description:
      'No inserta ninguna transacción: deja las filas en staging con su resultado de ' +
      'validación por fila. Requiere confirmar aparte con el `importacionId` devuelto.',
  })
  @ApiConsumes('multipart/form-data')
  // Sin @ApiBody, Swagger no dibuja el selector de archivo y el endpoint
  // no se puede probar desde /docs.
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV con encabezado: folio, fecha, tienda, sku, presentacion, cantidad, precio.',
        },
      },
    },
  })
  // El límite se aplica en el borde: sin `limits`, multer bufferea el
  // archivo completo en memoria antes de que el servicio pueda rechazarlo.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ARCHIVO_BYTES, files: 1 } }))
  @ApiRespuesta(201, 'Preview validado (nada insertado todavía).', muestras.previewCsv)
  @ApiErrores(400, 401, 403, 409, 413, 415, 503)
  previewCsvImport(
    @UploadedFile() file: ArchivoSubido,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.transactionsService.previewCsvImport(file, usuario, token);
  }

  @Post('import/confirm')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({
    summary: 'Paso 2 de la importación: confirma e inserta solo las filas válidas.',
    description:
      'Cada folio entra completo o no entra: venta, líneas y canasta van en una sola ' +
      'transacción de base de datos. El resumen reporta lo realmente insertado, las ' +
      'filas rechazadas en la validación y los folios omitidos con su motivo.',
  })
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
  @ApiOperation({ summary: 'Importaciones validadas que todavía no se confirman.' })
  @ApiRespuesta(200, 'Importaciones por confirmar.', [muestras.importacionPendiente])
  @ApiErrores(401, 403)
  pendingImports() {
    return this.transactionsService.listPendingImports();
  }

  @Get()
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Transacciones con filtros combinables y paginación.',
    description: 'Filtros por tienda y rango de fechas (AND). `dateTo` incluye el día completo.',
  })
  @ApiRespuesta(200, 'Transacciones con filtros.', pagina([muestras.transaccion], 100))
  @ApiErrores(400, 401, 403)
  findAll(@Query() filters: TransactionFilterDto) {
    return this.transactionsService.findAll(filters);
  }

  @Get(':id')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Una transacción con su detalle de líneas.' })
  @ApiRespuesta(200, 'Transacción con detalle.', muestras.transaccion)
  @ApiErrores(400, 401, 403, 404)
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.transactionsService.findOne(id);
  }
}
