const express = require("express");

const SocketPort = 1081;
const HttpPort = process.env.port || 1080;

const app = express();

const users: User[] = new Array<User>();

app.listen(HttpPort, () => {
    console.log('listen http port \"' + HttpPort + "\" ok")
});

const io = require('socket.io').listen(SocketPort);

io.sockets.on('connection', (socket: any) => {
    const userProfile = {
        interlocutorOne: undefined,
        isDispatcher: false,
        socketId: socket.id,
        timestampLastMessage: 0
    } as User;
    console.log("user connected " + "[" + userProfile.socketId + "]");
    socket.on("my_role", (msg: any) => {
        if (!msg && msg.role) {
            socket.emit('warn', {"message": "empty answer"});
            socket.disconnect();
            return;
        }
        if (msg.role === "USER") {
            userProfile.isDispatcher = false;
        } else if (msg.role === "DISPATCHER") {
            userProfile.isDispatcher = true;
        } else {
            //сложно представить такую ситуацию
            socket.emit('warn', {"message": "wrong answer"});
            socket.disconnect();
            return;
        }
        if (userProfile.isDispatcher) {
            userProfile.interlocutorOne = findFreeUser(userProfile.socketId); // ищем свободного диспетчера
        } else {
            userProfile.interlocutorOne = findFreeDispatcher(userProfile.socketId); // ищем свободного диспетчера
        }
        if (userProfile.interlocutorOne) { //в теории может не быть свободного диспетчера/пользователяя
            sendEmitTo(userProfile.interlocutorOne, "new_interlocutor", {id: userProfile.socketId});
            sendEmitTo(userProfile.socketId, "new_interlocutor", {id: userProfile.interlocutorOne});
        }
        users.push(userProfile);
        console.log('[' + userProfile.socketId + ']' + " MY_ROLE is " + msg.role);
    });

    socket.emit("get_role", {u_id: userProfile.socketId}); // запрашиваем роль сообщая его id'шник

    socket.on("message", (msg: any) => {
        console.log("message from " + '[' + userProfile.socketId + ']' + " is " + msg);
        if (!isRegisterUser(userProfile.socketId)) {
            socket.emit("warn", {"message": "before send message, need send role"});
            return;
        }
        if (userProfile.isDispatcher) {
            if (userProfile.interlocutorOne) {
                userProfile.timestampLastMessage = new Date().getTime();
                sendEmitTo(userProfile.interlocutorOne, "message", msg); // просто пробрасываем сообщение, сами разберуться
            } else {
                socket.emit("warn", {"message": "you don't have user"});
            }
        } else {
            if (userProfile.interlocutorOne) {
                sendEmitTo(userProfile.interlocutorOne, "message", msg); // просто пробрасываем сообщение, сами разберуться
            } else {
                userProfile.interlocutorOne = findFreeDispatcher(userProfile.socketId);
                if (userProfile.interlocutorOne) {
                    sendEmitTo(userProfile.interlocutorOne, "new_interlocutor", {id: userProfile.socketId}); // сообщаем, что кто-то подключился
                    sendEmitTo(userProfile.socketId, "new_interlocutor", {id: userProfile.interlocutorOne});
                    sendEmitTo(userProfile.interlocutorOne, "message", msg); // просто пробрасываем сообщение, сами разберуться
                } else {
                    socket.emit("warn", {"message": "no free dispatcher"});
                }
            }
        }
    });

    socket.on("find_dispatcher", () => {
        if (userProfile.isDispatcher || userProfile.interlocutorOne) {
            return;
        }
        userProfile.interlocutorOne = findFreeDispatcher(userProfile.socketId);
        if (userProfile.interlocutorOne) {
            sendEmitTo(userProfile.interlocutorOne, "new_interlocutor", {id: userProfile.socketId}); // сообщаем, что кто-то подключился
            sendEmitTo(userProfile.socketId, "new_interlocutor", {id: userProfile.interlocutorOne});
            socket.emit()
        }
    });

    socket.on('disconnect', () => {
        console.log("user disconnected " + "[" + userProfile.socketId + "]");
        if (userProfile.interlocutorOne) {
            const u: User | undefined = findUser(userProfile.interlocutorOne);
            if (u) {
                sendEmitTo(u.socketId, "interlocutor_disconnected", {"id": userProfile.socketId});
                u.interlocutorOne = undefined;
                if (u.isDispatcher) {
                    u.interlocutorOne = findFreeUser(u.socketId);
                    if (u.interlocutorOne) {
                        sendEmitTo(u.interlocutorOne, "new_interlocutor", {id: u.socketId}); // сообщаем, что кто-то подключился
                        sendEmitTo(u.socketId, "new_interlocutor", {id: u.interlocutorOne});
                    }
                }
            }
        }
        const index: number = users.indexOf(userProfile, 0);
        if (index > -1) {
            users.splice(index, 1);
        }
    })
});

function sendEmitTo(id: string, event: string, obj?: object) {
    io.sockets.sockets[id]?.emit(event, obj);
}

function isRegisterUser(id: string): boolean {
    for (let i = 0; i < users.length; i++) {
        if (users[i]) {
            if (users[i].socketId === id) {
                return true;
            }
        }
    }
    return false;
}

function findUser(id: string): User | undefined {
    for (let i = 0; i < users.length; i++) {
        if (users[i]) {
            if (users[i].socketId === id) {
                return users[i];
            }
        }
    }
    return undefined;
}

function findFreeUser(idDispatcher: string): string | undefined {
    for (let i = 0; i < users.length; i++) {
        if (users[i]) {
            if (!users[i].isDispatcher && !users[i].interlocutorOne) { // если диспетчер и нет клиентов
                users[i].interlocutorOne = idDispatcher;
                return users[i].socketId;
            }
        }
    }
    return undefined;
}

function findFreeDispatcher(idUser: string): string | undefined { //потенциальный косяк синхронности и гонок
    let potensialDispatcher: User | undefined = undefined;
    for (let i = 0; i < users.length; i++) {
        if (users[i]) {
            if (users[i].isDispatcher && !users[i].interlocutorOne) { // если диспетчер и нет клиентов
                if (potensialDispatcher) { //ранее был найден диспетчер?
                    if (potensialDispatcher.timestampLastMessage > users[i].timestampLastMessage) { // если у потенциального диспетчера время последнего сообщения больше текущего найденного дисп.
                        potensialDispatcher = users[i];
                    }
                } else {
                    //нашил потенциальго диспетчего
                    potensialDispatcher = users[i];
                }
            }
        }
    }
    if (potensialDispatcher) {
        potensialDispatcher.interlocutorOne = idUser;
        return potensialDispatcher.socketId;
    }
    return undefined;
}


interface User {
    isDispatcher: boolean,
    socketId: string,
    interlocutorOne: string | undefined, //Socket ids
    timestampLastMessage: number
}
