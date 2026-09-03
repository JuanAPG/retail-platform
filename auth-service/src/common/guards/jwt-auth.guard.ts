import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Aplica sobre cualquier endpoint que requiera un usuario autenticado. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
