// TinyMCE Configuration Module
// Contains base configuration for TinyMCE editor

import { getAssetVersion } from '../../config.js';
import { uploadImageMultipart } from './upload.js';
import { setupCustomButtons } from './buttons.js';
import { setupDesign, getDesignFormats, getDesignStyleFormats } from './design.js';
import { applyTinyMCETheme, isSoftTheme } from './theme.js';

// Fraunces/DM Mono for the soft theme's editor content (the iframe does not share the page's fonts)
const SOFT_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,0..100,0..1;1,9..144,300..700,0..100,0..1&family=DM+Mono:wght@400;500&display=swap';

/**
 * Get TinyMCE configuration object
 * @returns {Object} TinyMCE configuration
 */
export function getTinyMCEConfig() {
  const assetVersion = (typeof getAssetVersion === 'function' && getAssetVersion()) || '';
  const cacheSuffix = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : '';
  const soft = isSoftTheme();
  
  return {
    selector: '#content',
    height: 650,
    resize: true,
    convert_urls: false,
    relative_urls: false,
    menubar: 'edit view insert format tools help',
    referrer_policy: 'origin',
    cache_suffix: cacheSuffix,
    
    // Disable premium features and tracking
    promotion: false,
    branding: false,
    license_key: 'gpl',
    
    // Skin and icons configuration (local, copied via postinstall)
    skin_url: '/assets/js/tinymce/skins/ui/oxide',
    // The light skin ("oxide") is used for both themes; only the content differs
    content_css: soft ? [
      '/assets/js/tinymce/skins/content/default/content.min.css',
      SOFT_FONTS_URL,
      '/assets/css/themes/soft/tinymce-content.css',
      '/assets/css/themes/soft/content.css',
    ] : [
      '/assets/js/tinymce/skins/content/default/content.min.css',
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=Crimson+Text:wght@400;600;700&display=swap',
      'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-okaidia.min.css',
      '/assets/css/tinymce-content.css',
      '/assets/css/content.css',
    ],
    
    // Language
    language: 'de',
    content_langs: [
      { title: 'Deutsch', code: 'de' },
      { title: 'English', code: 'en' }
    ],
    
    // Plugins
    plugins: [
      'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
      'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
      'insertdatetime', 'media', 'table', 'help', 'wordcount',
      'save', 'directionality', 'emoticons',
      'codesample', 'nonbreaking', 'pagebreak', 'quickbars', 'accordion',
    ],

    // Code sample languages (Prism autoloader fetches grammars on demand)
    codesample_languages: [
      { text: 'HTML/XML', value: 'markup' },
      { text: 'CSS', value: 'css' },
      { text: 'JavaScript', value: 'javascript' },
      { text: 'TypeScript', value: 'typescript' },
      { text: 'JSON', value: 'json' },
      { text: 'Bash/Shell', value: 'bash' },
      { text: 'Python', value: 'python' },
      { text: 'Java', value: 'java' },
      { text: 'C', value: 'c' },
      { text: 'C++', value: 'cpp' },
      { text: 'C#', value: 'csharp' },
      { text: 'Go', value: 'go' },
      { text: 'Rust', value: 'rust' },
      { text: 'PHP', value: 'php' },
      { text: 'Ruby', value: 'ruby' },
      { text: 'SQL', value: 'sql' },
      { text: 'YAML', value: 'yaml' },
      { text: 'INI', value: 'ini' },
      { text: 'Log', value: 'log' },
      { text: 'Nginx', value: 'nginx' },
      { text: 'Docker', value: 'docker' },
      { text: 'Markdown', value: 'markdown' },
      { text: 'Diff', value: 'diff' },
      { text: 'Plain Text', value: 'plaintext' },
    ],

    // Toolbar
    toolbar: [
      'undo redo | bold italic underline strikethrough | fontfamily fontsize forecolor backcolor',
      'alignleft aligncenter alignright alignjustify | bullist numlist outdent indent',
      'pcdesign | link image media table | codesample blockquote customblockquote hr pagebreak | emoticons charmap',
      'searchreplace visualblocks code fullscreen preview | save help',
    ],
    toolbar_mode: 'floating',
    quickbars_selection_toolbar: 'bold italic underline | quicklink blockquote',
    quickbars_insert_toolbar: 'image media table hr',
    // Clicking an image: float it left/right (text flows around it) or centre it, size S/M/L, wider than the column
    quickbars_image_toolbar: 'alignleft aligncenter alignright | pcimgsmall pcimgmedium pcimglarge pcimgwide | image',
    contextmenu: 'link image table configurepermanentpen',
    
    // Formatting
    font_family_formats: 'Playfair Display=Playfair Display,serif; Crimson Text=Crimson Text,serif; Arial=arial,helvetica,sans-serif; Helvetica=helvetica,sans-serif; Times New Roman=times new roman,times,serif; Georgia=georgia,palatino,serif; Verdana=verdana,geneva,sans-serif; Monospace=monospace',
    font_size_formats: '8pt 10pt 12pt 14pt 16pt 18pt 20pt 24pt 28pt 32pt 36pt 48pt 60pt 72pt',
    block_formats: 'Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; Heading 4=h4; Heading 5=h5; Heading 6=h6; Preformatted=pre; Address=address',
    
    // Style formats
    style_formats: [
      {title: 'Headers', items: [
        {title: 'Header 1', block: 'h1'},
        {title: 'Header 2', block: 'h2'},
        {title: 'Header 3', block: 'h3'},
      ]},
      {title: 'Inline', items: [
        {title: 'Bold', inline: 'strong'},
        {title: 'Italic', inline: 'em'},
        {title: 'Code', inline: 'code'},
      ]},
      ...getDesignStyleFormats(),
    ],

    // Alignment and the "Gestaltung" styles as classes (design.js): style attributes do not survive saving
    formats: getDesignFormats(),
    
    // Image upload
    images_upload_handler: async (blobInfo, progress) => {
      return await uploadImageMultipart(blobInfo, progress);
    },

    // Keep rich text — but strip pasted inline styles from AI tools (Gemini, ChatGPT)
    valid_elements: '*[*]',
    extended_valid_elements: 'span[*],p[*],div[*],img[*],a[*],table[*],tbody[*],thead[*],tfoot[*],tr[*],th[*],td[*],h1[*],h2[*],h3[*],h4[*],h5[*],h6[*]',

    paste_preprocess: function(plugin, args) {
      let c = args.content;
      // Strip AI wrapper divs (Gemini class="markdown ...")
      c = c.replace(/<div\b[^>]*class="[^"]*markdown[^"]*"[^>]*>([\s\S]*?)<\/div>\s*$/i, '$1');
      // Remove all style attributes
      c = c.replace(/\s*style="[^"]*"/gi, '');
      // Unwrap empty spans
      c = c.replace(/<span\b(?:\s+class="[^"]*")?\s*>([\s\S]*?)<\/span>/gi, '$1');
      // Remove AI-specific attributes
      c = c.replace(/\s*(?:id|dir|aria-\w+|data-[\w-]+)="[^"]*"/gi, '');
      // Remove Gemini-specific classes
      c = c.replace(/\s*class="[^"]*(?:ng-tns|ng-star|ng-trigger|ng-animate|gds-title|code-block-decoration|formatted-code|animated-opacity|markdown-main)[^"]*"/gi, '');
      // Clean up empty class attrs and divs
      c = c.replace(/\s*class=""/g, '');
      c = c.replace(/<div\s*>\s*<\/div>/gi, '');
      args.content = c;
    },
    
    // Image settings
    paste_data_images: true,
    automatic_uploads: true,
    images_file_types: 'jpg,jpeg,png,gif,webp',
    image_dimensions: false,
    // Captions: the image dialog offers "Bildunterschrift", which wraps the image in <figure class="image">.
    // No image_class_list: the dialog would overwrite the layout classes (align-left, pc-size-s, …) on saving.
    image_caption: true,
    
    // Spellcheck
    browser_spellcheck: true,
    
    // Branding
    branding: false,
    promotion: false,
    
    // Shortcuts
    custom_shortcuts: true,
    
    // Table
    table_toolbar: 'tableprops tabledelete | tableinsertrowbefore tableinsertrowafter tabledeleterow',
    
    // Links
    link_context_toolbar: true,
    
    // Lists
    lists_indent_on_tab: true,
    
    // Note: Templates configuration removed as 'template' plugin is deprecated in TinyMCE 6
    // For templates, consider using Advanced Template plugin or custom buttons
    
    // Setup function
    setup: function(editor) {
      // Register custom buttons
      setupCustomButtons(editor);
      setupDesign(editor);
      
      // Make images responsive
      const makeImagesResponsive = () => {
        const images = editor.getDoc().querySelectorAll('img');
        images.forEach(img => {
          img.removeAttribute('width');
          img.removeAttribute('height');
          img.style.width = '';
          img.style.height = '';
          if (!img.classList.contains('img-responsive')) {
            img.classList.add('img-responsive');
          }
        });
      };
      
      editor.on('NodeChange', makeImagesResponsive);
      editor.on('SetContent', makeImagesResponsive);
      editor.on('BeforeSetContent', function(e) {
        if (e.content && e.content.includes('<img')) {
          e.content = e.content.replace(/(<img[^>]*)\s+width=["'][^"']*["']/gi, '$1');
          e.content = e.content.replace(/(<img[^>]*)\s+height=["'][^"']*["']/gi, '$1');
          e.content = e.content.replace(/(<img[^>]*)\s+style=["'][^"']*["']/gi, '$1');
        }
      });
      editor.on('paste', function() {
        setTimeout(makeImagesResponsive, 100);
      });
      
      // Update preview on content change
      editor.on('Change', function() {
        // Dispatch custom event for preview update
        document.dispatchEvent(new CustomEvent('tinymce:contentChanged'));
      });
      editor.on('KeyUp', function() {
        // Dispatch custom event for preview update
        document.dispatchEvent(new CustomEvent('tinymce:contentChanged'));
      });
      
      // Apply the page theme and, for the dark theme, inject Prism Okaidia CSS after
      // TinyMCE's codesample plugin injects its bundled (light) Prism CSS.
      // The light theme keeps the bundled light Prism CSS and adds its own muted token colours.
      editor.on('init', function() {
        applyTinyMCETheme(editor);
        var doc = editor.getDoc();
        // The browser only hyphenates (justified paragraphs) when it knows the language
        if (doc && doc.documentElement && !doc.documentElement.lang) doc.documentElement.lang = 'de';
        if (!soft && doc && doc.head) {
          var link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-okaidia.min.css';
          doc.head.appendChild(link);
        }
      });
      
      // Listen for theme changes
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('themeChanged', function() {
          applyTinyMCETheme(editor);
        });
      }
    }
  };
}
