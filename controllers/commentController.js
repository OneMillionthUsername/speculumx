import logger from '../utils/logger.js';
import { DatabaseService } from '../databases/mariaDB.js';
import Comment from '../models/commentModel.js';
import { CommentControllerException } from '../models/customExceptions.js';
import { normalizePublished } from '../utils/normalizers.js';
import contactMailService from '../services/contactMailService.js';

async function createCommentRecord(postId, body) {
  const commentData = {
    ...(body || {}),
    postId: postId,
    username: body.username || 'Anonym',
    created_at: new Date(),
    approved: true,
    published: true,
  };

  const { error, value } = Comment.validate(commentData);
  if (error) {
    throw new CommentControllerException(
      'Validation failed: ' + error.details.map(d => d.message).join('; '),
      { validationErrors: error.details },
    );
  }

  // Comments are plain text: stored RAW, escaped at output (EJS `<%= %>`).
  // Notification mails are text/plain with their own header sanitization
  // in contactMailService, so raw text is fine there too.
  value.text = String(value.text || '');
  if (!value.username || String(value.username).trim() === '') {
    value.username = 'Anonym';
  } else {
    value.username = String(value.username).trim();
  }

  const result = await DatabaseService.createComment(postId, value);
  if (!result || result.affectedRows === 0) {
    throw new CommentControllerException(
      'Failed to save comment to database',
      { postId, commentData: value, dbResult: result },
    );
  }

  return result;
}

async function sendCommentNotification({ req, postId, comment }) {
  try {
    const post = await DatabaseService.getPostById(postId);
    const host = req?.get ? req.get('host') : null;
    const forwardedProto = req?.get ? req.get('x-forwarded-proto') : null;
    const proto = req?.secure || forwardedProto === 'https' ? 'https' : 'http';
    const baseUrl = host ? `${proto}://${host}` : '';
    const postUrl = baseUrl ? `${baseUrl}/blogpost/id/${postId}#comments-section` : `/blogpost/id/${postId}#comments-section`;
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
      || req?.headers?.['x-real-ip']
      || req?.ip
      || req?.socket?.remoteAddress
      || 'unknown';
    const userAgent = req?.get ? (req.get('User-Agent') || 'unknown') : 'unknown';

    await contactMailService.sendCommentNotificationMail({
      postId,
      postTitle: post?.title || `Post #${postId}`,
      postUrl,
      username: comment?.username || 'Anonym',
      text: comment?.text || '',
      ip,
      userAgent,
    });
  } catch (error) {
    logger.error('[COMMENT_NOTIFY] Failed to send comment notification email', {
      error: error && error.message ? error.message : String(error),
    });
  }
}

async function buildValidatedComments(postId) {
  if (isNaN(postId) || postId <= 0) {
    throw new CommentControllerException(
      'Invalid post ID provided',
      { providedPostId: postId },
    );
  }

  const comments = await DatabaseService.getCommentsByPostId(postId);
  if (!comments || comments.length === 0) {
    return [];
  }

  const validComments = [];
  for (const comment of comments) {
    // Add missing required fields for validation
    const commentData = {
      ...comment,
      postId: postId,
    };

    const { error, value } = Comment.validate(commentData);
    if (error) {
      console.error('Validation failed for comment:', error.details.map(d => d.message).join('; '));
      continue;
    }

    value.published = normalizePublished(value.published);
    if (!value.published) {
      continue;
    }
    validComments.push(new Comment(value));
  }

  return validComments;
}

async function deleteCommentRecord(postId, commentId) {
  if (isNaN(commentId) || commentId <= 0) {
    throw new CommentControllerException(
      'Invalid comment ID provided',
      { providedCommentId: commentId },
    );
  }

  if (isNaN(postId) || postId <= 0) {
    throw new CommentControllerException(
      'Invalid post ID provided',
      { providedPostId: postId },
    );
  }

  const result = await DatabaseService.deleteComment(commentId, postId);
  if (!result || !result.success) {
    throw new CommentControllerException(
      'Comment not found or deletion failed',
      { commentId, postId, dbResult: result },
    );
  }

  return result;
}

/**
 * Express-Handler: Erstellt einen Kommentar für einen Blog-Post.
 *
 * Erwartet `postId` als URL-Parameter und Kommentar-Daten im Request-Body.
 * Führt serverseitige Validierung und Sanitization durch bevor in der DB gespeichert wird.
 *
 * @param {import('express').Request} req - Express Request-Objekt.
 * @param {import('express').Response} res - Express Response-Objekt.
 * @returns {Promise<void>} Sendet JSON-Antwort mit Erfolg oder Fehler.
 */
const createComment = async (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    const created = await createCommentRecord(postId, req.body);
    void sendCommentNotification({ req, postId, comment: created?.comment });
    res.json({ success: true, message: 'Comment created successfully' });
  } catch (error) {
    console.error('Error creating comment:', error);

    if (error instanceof CommentControllerException) {
      return res.status(400).json({ 
        error: error.message,
        details: error.details, 
      });
    }

    res.status(500).json({ error: 'Failed to create comment' });
  }
};
/**
 * Express-Handler: Liest alle Kommentare zu einem bestimmten Post und gibt
 * nur validierte Kommentare als JSON zurück.
 *
 * @param {import('express').Request} req - Express Request-Objekt.
 * @param {import('express').Response} res - Express Response-Objekt.
 * @returns {Promise<void>} Sendet JSON-Array von Kommentaren oder Fehler.
 */
const getCommentsByPostId = async (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    const validComments = await buildValidatedComments(postId);
    res.json(validComments);
  } catch (error) {
    console.error('Error getting comments:', error);
    
    if (error instanceof CommentControllerException) {
      return res.status(400).json({ 
        error: error.message,
        details: error.details, 
      });
    }
    
    res.status(500).json({ error: 'Failed to load comments' });
  }
};
/**
 * Express-Handler: Löscht einen Kommentar zu einem Post. Erwartet `postId` und
 * `commentId` als URL-Parameter.
 *
 * @param {import('express').Request} req - Express Request-Objekt.
 * @param {import('express').Response} res - Express Response-Objekt.
 * @returns {Promise<void>} Sendet JSON-Antwort mit Erfolg oder Fehler.
 */
const deleteComment = async (req, res) => {
  try {
    const commentId = parseInt(req.params.commentId);
    const postId = parseInt(req.params.postId);
    await deleteCommentRecord(postId, commentId);
    res.json({ success: true, message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    
    if (error instanceof CommentControllerException) {
      return res.status(400).json({ 
        error: error.message,
        details: error.details, 
      });
    }
    
    res.status(500).json({ error: 'Failed to delete comment' });
  }
};
export default {
  createComment,
  getCommentsByPostId,
  deleteComment,
  sendCommentNotification,
  fetchCommentsByPostId: buildValidatedComments,
  createCommentRecord,
  deleteCommentRecord,
};