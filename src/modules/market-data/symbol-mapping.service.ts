import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SymbolMapping } from './entities/symbol-mapping.entity';

@Injectable()
export class SymbolMappingService {
  constructor(
    @InjectRepository(SymbolMapping)
    private readonly repository: Repository<SymbolMapping>,
  ) {}

  async getActiveMappings(
    internalSymbol: string,
  ): Promise<SymbolMapping[]> {
    return this.repository.find({
      where: {
        internalSymbol,
        isActive: true,
      },
      relations: {
        exchange: true,
      },
    });
  }
}
