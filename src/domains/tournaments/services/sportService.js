import sportRepository from '../repositories/sportRepository.js';
import { NotFoundError, ConflictError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export class SportService {
  async getAll(options = {}) {
    return sportRepository.findAll(options);
  }

  async getById(id) {
    const sport = await sportRepository.findById(id);
    if (!sport) {
      throw new NotFoundError('Sport not found');
    }
    return sport;
  }

  async getBySlug(slug) {
    const sport = await sportRepository.findBySlug(slug);
    if (!sport) {
      throw new NotFoundError('Sport not found');
    }
    return sport;
  }

  async create(data) {
    const existing = await sportRepository.findBySlug(data.slug || generateSlug(data.name));
    if (existing) {
      throw new ConflictError('Sport with this slug already exists');
    }

    const sport = await sportRepository.create({
      name: data.name,
      slug: data.slug || generateSlug(data.name),
      icon: data.icon,
      description: data.description,
      rules: data.rules || {},
      scoring_config: data.scoring_config || { win: 3, draw: 1, loss: 0 },
      is_active: data.is_active !== undefined ? data.is_active : true
    });

    logger.info('Sport created', { sportId: sport.id, name: sport.name });
    return sport;
  }

  async update(id, data) {
    await this.getById(id);

    if (data.slug) {
      const existing = await sportRepository.findBySlug(data.slug);
      if (existing && existing.id !== id) {
        throw new ConflictError('Sport with this slug already exists');
      }
    }

    return sportRepository.update(id, data);
  }

  async delete(id) {
    await this.getById(id);
    return sportRepository.softDelete(id);
  }

  getScoringEngine(sportSlug) {
    const engines = {
      football: () => import('../../scoring/engines/footballScoringEngine.js'),
      cricket: () => import('../../scoring/engines/cricketScoringEngine.js'),
      basketball: () => import('../../scoring/engines/basketballScoringEngine.js'),
      volleyball: () => import('../../scoring/engines/volleyballScoringEngine.js'),
      badminton: () => import('../../scoring/engines/badmintonScoringEngine.js'),
      table_tennis: () => import('../../scoring/engines/tableTennisScoringEngine.js')
    };

    const engineLoader = engines[sportSlug];
    if (!engineLoader) {
      throw new Error(`No scoring engine found for sport: ${sportSlug}`);
    }

    return engineLoader();
  }
}

export default new SportService();