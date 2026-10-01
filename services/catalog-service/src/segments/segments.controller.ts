import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { SegmentFilterDto } from './dto/segment-filter.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';

/** M05 — Segmentos de ingreso. Contrato: docs/contratos/catalog-service.md */
@ApiTags('M05 Segments')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
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
  findAll(@Query() filtros: SegmentFilterDto) {
    return this.segmentsService.findAll(filtros);
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
  @HttpCode(204)
  @Roles(ROL.ADMINISTRADOR)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.segmentsService.remove(id);
  }
}
