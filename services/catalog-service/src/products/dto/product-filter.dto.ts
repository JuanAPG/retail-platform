import { PaginationDto } from '../../common/dto/pagination.dto';

/** Query de `GET /v1/products`, `GET /v1/products/pending` y `GET /v1/providers`: solo paginación. */
export class ProductFilterDto extends PaginationDto {}
