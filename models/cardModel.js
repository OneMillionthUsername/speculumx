import Joi from 'joi';

export class Card{
  constructor({
    id = null,
    title = '',
    subtitle = '',
    link = '',
    img_link = '',
    published = false,
  } = {})
  {
    this.id = id;
    this.title = title;
    this.subtitle = subtitle;
    this.link = link;
    this.img_link = img_link;
    this.published = published;
  }

  static validate(payload = {}) {
    return cardSchema.validate(payload, { abortEarly: false, stripUnknown: true });
  }
}

export const cardSchema = Joi.object({
  id: Joi.number().integer().optional(),
  title: Joi.string().min(1).max(255).required(),
  subtitle: Joi.string().max(500).allow(null).optional(),
  link: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  img_link: Joi.alternatives().try(
    Joi.string().uri({ scheme: ['https'] }),
    Joi.string().pattern(/^\/[^\0]+$/),
  ).required(),
  published: Joi.boolean().optional(),
});