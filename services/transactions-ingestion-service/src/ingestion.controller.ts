import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe,
  Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional } from 'class-validator';
import type { Request } from 'express';
import { XmlRoot } from './common/decorators/xml-root.decorator';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, PaginationDto } from './common/dto/pagination.dto';
import { SessionGuard, SesionUsuario } from './common/auth/session.guard';
import { ROL } from './common/roles';
import { IngestionService, states } from './ingestion.service';
import { maxBytes, xmlDocument } from './files';

class ListQuery extends PaginationDto {
  @IsOptional()
  @IsIn(states)
  state?: string;
}

type SessionRequest = Request & { user: SesionUsuario };
type Upload = { buffer: Buffer; mimetype: string; originalname: string };

@ApiTags('Ingesta de ventas')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('transaction-imports')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  private actor(req: SessionRequest, write = false): SesionUsuario {
    if (req.user.rol === ROL.ANALISTA || (!write && req.user.rol === ROL.ADMINISTRADOR)) return req.user;
    throw new ForbiddenException('El perfil no tiene acceso a esta operación de ingesta.');
  }

  @Post()
  @XmlRoot('transactionImport')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxBytes, files: 1, fields: 0 } }))
  upload(@Req() req: SessionRequest, @UploadedFile() file: Upload, @Headers('authorization') token: string) {
    const actor = this.actor(req, true);
    if (!file?.buffer.length) throw new BadRequestException('Adjunta el archivo de ventas.');
    return this.ingestion.upload(file.buffer, file.originalname, file.mimetype, actor, token);
  }

  @Post('from-object')
  @XmlRoot('transactionImport')
  @ApiConsumes('application/json', 'application/xml')
  fromObject(@Req() req: SessionRequest, @Body() input: unknown, @Headers('authorization') token: string) {
    const actor = this.actor(req, true);
    const body = (typeof input === 'string' ? xmlDocument(input, 'objectImport') : input) as
      { objectKey?: unknown; generation?: unknown } | undefined;
    if (!body || typeof body.objectKey !== 'string' || body.objectKey.length > 1024 ||
        typeof body.generation !== 'string' || !/^\d{1,25}$/.test(body.generation)) {
      throw new BadRequestException('Se requiere objectKey y generation como cadenas.');
    }
    return this.ingestion.fromObject(body.objectKey, body.generation, actor, token);
  }

  @Get()
  @XmlRoot('transactionImports')
  list(@Req() req: SessionRequest, @Query() query: ListQuery) {
    return this.ingestion.list(this.actor(req), query.page ?? PAGINA_DEFAULT,
      Math.min(query.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO), query.state);
  }

  @Get(':id')
  @XmlRoot('transactionImport')
  detail(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: SessionRequest) {
    return this.ingestion.detail(id, this.actor(req));
  }

  @Get(':id/rows')
  @XmlRoot('transactionImportRows')
  rows(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: SessionRequest, @Query() query: PaginationDto) {
    return this.ingestion.rows(id, this.actor(req), query.page ?? PAGINA_DEFAULT, Math.min(query.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @XmlRoot('transactionImport')
  confirm(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: SessionRequest, @Headers('authorization') token: string) {
    return this.ingestion.confirm(id, this.actor(req, true), token);
  }

  @Delete(':id')
  @XmlRoot('transactionImport')
  discard(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: SessionRequest) {
    return this.ingestion.discard(id, this.actor(req, true));
  }
}
