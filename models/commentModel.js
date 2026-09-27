import Joi from 'joi';

export default class Comment {
  constructor({
    id = null,
    postId = null,
    username = 'Anonym',
    text = '',
    ip_address = null,
    approved = true,
    published = false,
    created_at = new Date(),
    updated_at = new Date(),
  } = {}) {
    this.id = id;
    this.postId = postId;
    this.username = username;
    this.text = text;
    this.ip_address = ip_address;
    this.approved = !!approved;
    this.published = !!published;
    this.created_at = new Date(created_at);
    this.updated_at = new Date(updated_at);
  }

  static validate(payload = {}) {
    return commentSchema.validate(payload, { abortEarly: false, stripUnknown: true });
  }
}

export const commentSchema = Joi.object({
  id: Joi.number().integer().optional(),
  postId: Joi.number().integer().min(1).required(),
  // Same limit as the route validation and the form's maxlength
  username: Joi.string().max(50).optional(),
  text: Joi.string().min(1).max(1000).required(),
  ip_address: Joi.string().ip().optional(),
  approved: Joi.boolean().optional(),
  published: Joi.boolean().optional(),
  created_at: Joi.date().required(),
  updated_at: Joi.date().optional(),
});

