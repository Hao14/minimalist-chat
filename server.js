import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve Vite's production output. Run `npm run build` first.
const webRoot = path.join(__dirname, 'dist');
app.use(express.static(webRoot));

// BrowserRouter routes (such as /chat and /join/:id) all boot from index.html.
app.use((request, response, next) => {
    if (request.method !== 'GET' || path.extname(request.path)) return next();
    response.sendFile(path.join(webRoot, 'index.html'));
});

// Handle real-time chat connections
io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('chat message', (msg) => {
        // Broadcast the message to everyone
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running locally at http://localhost:${PORT}`);
});
