import 'dotenv/config';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  handleAdminResponders,
  handleAssistantChat,
  handleHealth,
  handleReverseGeocode,
} from './server/apiHandlers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Ensure malformed JSON request bodies return JSON rather than Express's HTML error page
  app.use(
    (err: unknown, req: Request, res: Response, next: NextFunction) => {
      if (err instanceof SyntaxError && 'body' in err) {
        if (req.path.startsWith('/api')) {
          res.status(400).json({ error: 'Invalid JSON request body.' });
          return;
        }
      }
      next(err);
    }
  );

  app.get('/api/health', (_req: Request, res: Response) => {
    const result = handleHealth();
    res.status(result.status).json(result.body);
  });

  // 1. Context-Aware Bayanihan Assistant Chat (Supabase + Google Search Grounding)
  app.post('/api/assistant/chat', async (req: Request, res: Response) => {
    const result = await handleAssistantChat(req.body, req.ip || 'unknown');
    res.status(result.status).json(result.body);
  });

  // 3. Reverse Geocoding Server Proxy (prevents browser CORS issues & legacy JS Geocoder usage)
  app.get('/api/geocode/reverse', async (req: Request, res: Response) => {
    const result = await handleReverseGeocode(
      req.query.lat,
      req.query.lng,
      req.ip || 'unknown'
    );
    res.status(result.status).json(result.body);
  });

  // 4. Admin-only Municipality Responder Management
  app.all('/api/admin/responders', async (req: Request, res: Response) => {
    const queryId =
      typeof req.query.id === 'string' ? req.query.id : undefined;
    const result = await handleAdminResponders({
      method: req.method,
      authHeader: req.headers.authorization,
      queryId,
      body: req.body,
    });
    res.status(result.status).json(result.body);
  });

  // Never let unmatched /api/* requests fall through to Vite / SPA HTML fallback
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ...(hmrDisabled ? { ws: false } : {}),
      },
      appType: 'spa',
    });

    if (hmrDisabled) {
      app.get(
        '/@vite/client',
        async (_req: Request, res: Response, next: NextFunction) => {
          try {
            const result = await vite.transformRequest('/@vite/client');
            if (!result?.code) {
              next();
              return;
            }
            const patched = result.code
              .replace(
                'transport.connect(createHMRHandler(handleMessage));',
                '/* HMR disabled via DISABLE_HMR */'
              )
              .replace(
                'else throw new SendBeforeConnectError("send was called before connect");',
                'else return;'
              )
              .replace(
                'else throw new SendBeforeConnectError("invoke was called before connect");',
                'else return undefined;'
              );
            res
              .setHeader('Cache-Control', 'no-store')
              .type('application/javascript')
              .send(patched);
          } catch (err) {
            next(err);
          }
        }
      );

      app.get(
        '/@vite-plugin-pwa/pwa-entry-point-loaded',
        (_req: Request, res: Response) => {
          res
            .setHeader('Cache-Control', 'no-store')
            .type('application/javascript')
            .send('export default function registerDevSW() {}\n');
        }
      );

      app.get(['/dev-sw.js', '/sw.js'], (_req: Request, res: Response) => {
        res
          .setHeader('Cache-Control', 'no-store')
          .type('application/javascript')
          .send(
            "self.addEventListener('install', () => self.skipWaiting());\n" +
              "self.addEventListener('activate', () => { self.registration.unregister(); });\n"
          );
      });
    }

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  // Global JSON error guard for any unexpected /api errors
  app.use(
    (err: unknown, req: Request, res: Response, _next: NextFunction) => {
      console.error('Unhandled server error:', err);
      if (req.path.startsWith('/api')) {
        res.status(500).json({ error: 'Internal server error.' });
        return;
      }
      res.status(500).send('Internal server error.');
    }
  );

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Bayanihan Alert Hub server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
