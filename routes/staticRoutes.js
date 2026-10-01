import express from 'express';
import staticPageController from '../controllers/staticPageController.js';
import csrfProtection from '../utils/csrf.js';
import { contactLimiter, globalLimiter } from '../utils/limiters.js';
import { validateFields } from '../middleware/validationMiddleware.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

/**
 * Routes serving site pages and server-side rendered views.
 *
 * These endpoints primarily render EJS templates (home, about, posts,
 * createPost editor) and perform minimal server-side composition like
 * fetching featured posts for the homepage.
 */
const staticRouter = express.Router();

staticRouter.get('/', csrfProtection, staticPageController.showHomePage);
staticRouter.get('/about', csrfProtection, staticPageController.showAboutPage);

// Explicit routes: one without parameter and one with the parameter. Some
// environments' path parsers can't handle '?' tokens in route strings.
staticRouter.get('/createPost', csrfProtection, staticPageController.showCreatePostPage);
staticRouter.get('/blogpost/update/:id', csrfProtection, staticPageController.showUpdatePostByIdPage);

staticRouter.get('/about.html', staticPageController.redirectAboutHtml);
staticRouter.get('/posts', csrfProtection, staticPageController.showPostsPage);
staticRouter.get('/search', globalLimiter, csrfProtection, staticPageController.showSearchPage);
staticRouter.get('/admin', csrfProtection, authenticateToken, requireAdmin, staticPageController.showAdminPage);

staticRouter.post(
  '/contact',
  contactLimiter,
  csrfProtection,
  validateFields({
    body: {
      name: { required: true, type: 'string', min: 2, max: 120 },
      email: {
        required: true,
        type: 'string',
        min: 5,
        max: 254,
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      },
      message: { required: true, type: 'string', min: 10, max: 4000 },
    },
  }),
  staticPageController.submitContactForm,
);

export default staticRouter;