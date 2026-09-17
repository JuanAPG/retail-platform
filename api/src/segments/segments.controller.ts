import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';

/**
 * M05 — Segmentos de ingreso. Nomenclatura tal como quedó en
 * `Contrato_Metodos_Endpoints` (Sprint 1): rutas y métodos en inglés
 * para que Leonardo (M09/M11) y Fernando (M07/M12) integren contra este
 * contrato sin adivinar nombres.
 */
@ApiTags('M05 Segments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('segments')
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Post()
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  create(@Body() dto: CreateSegmentDto) {
    return this.segmentsService.create(dto);
  }

  @Get()
  @Roles(...PERFILES_INTERNOS)
  findAll() {
    return this.segmentsService.findAll();
  }

  @Get(':id')
  @Roles(...PERFILES_INTERNOS)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.segmentsService.findOne(id);
  }

  @Patch(':id')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSegmentDto) {
    return this.segmentsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(ROL.ADMINISTRADOR)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.segmentsService.remove(id);
  }
}
