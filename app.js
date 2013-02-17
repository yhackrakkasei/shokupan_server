"use strict";

var express = require('express'),
    routes = require('./routes'),
    http = require('http'),
    path = require('path'),
    mongoose = require('mongoose');

var Schema = mongoose.Schema;
mongoose.connect('mongodb://localhost/shokupan');

//ユーザのスキーマ定義
var UserSchema = new Schema({
    name: {type: String},
    gender: {type: String},
    profile: {type: String}
});
var User = mongoose.model('User', UserSchema);

//ユーザが見ているページのスキーマ定義
var PageSchema = new Schema({
    url_hash: {type: String},
    user: {type: String},
    session_id: {type: String},
    timestamp: {type: Number},
    status: {type: String}
});
var Page = mongoose.model('Page', PageSchema);

// ぶつかった判定のユーザごとのスキーマ定義
var CrashUserSchema = new Schema({
    user: {type: String},
    aite: {type: String},
    user_session: {type: String},
    aite_session: {type: String},
    crash_id: {type: String},
});
var CrashUser = mongoose.model('CrashUser', CrashUserSchema);

// ぶつかった判定のスキーマ定義
var CrashSchema = new Schema({
    crash_id: {type: String},
    timestamp: {type: Number},
    status: {type: String}
});
var Crash = mongoose.model('Crash', CrashSchema);

// 再会判定のユーザごとのスキーマ定義
var ReunionUserSchema = new Schema({
    user: {type: String},
    aite: {type: String},
    user_session: {type: String},
    aite_session: {type: String},
    reunion_id: {type: String},
});
var ReunionUser = mongoose.model('ReunionUser', ReunionUserSchema);

// 再会判定のスキーマ定義
var ReunionSchema = new Schema({
    reunion_id: {type: String},
    answer: {type: String},
    timestamp: {type: Number},
    status: {type: String}
});
var Reunion = mongoose.model('Reunion', ReunionSchema);

var app = express();

app.configure(function() {
  app.set('port', process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function() {
  app.use(express.errorHandler());
});

app.get('/', routes.index);

var server = http.createServer(app);
server.listen(app.get('port'), function() {
  console.log("Express server listening on port " + app.get('port'));
});


var io = require('socket.io').listen(server);

// ロジック本体
io.sockets.on('connection',function(socket) {

    // ユーザ登録リクエスト
    socket.on('regist', function(data) {
        console.log("[regist]"+data.name);

        User.findOne({name: data.name}, "name profile gender", function(err, user) {
            if (err !== null) {
                console.error("error:"+err);
                socket.json.emit('error', {text:"error:"+err});
                return;
            }

            if (user !== null) {
                // すでに登録済みの場合は情報アップデート
                user.profile = data.profile;
                user.gender = data.gender;

                user.save(function(err) {
                    if (err !== null) {
                        console.error("error:"+err);
                        socket.json.emit('error', {text:"error:"+err});
                        return;
                    }
                    socket.json.emit('message', {text:"update:"+user.name});
                });

            } else {
                // まだ登録されていないのでアップデート
                var new_user = new User({
                    name: data.name,
                    profile : data.profile,
                    gender : data.gender
                });

                new_user.save(function(err) {
                    if (err !== null) {
                        console.error("error:"+err);
                        socket.json.emit('error', {text:"error:"+err});
                        return;
                    }

                    socket.json.emit('message', {text:"regist:"+new_user.name});
                });
            }
        });
    });

    // ユーザ確認
    socket.on('get_user', function(data) {
        console.log("[get_user]"+data.name);

        User.findOne({name: data.name}, "name profile gender", function(err, user) {
            if (err !== null) {
                console.error("error:"+err);
                socket.json.emit('error', {text:"error:"+err});
                return;
            }

            if (user !== null) {
                socket.json.emit('message', {text:"get_user:"+user.name});
            } else {
                socket.json.emit('message', {text:"get_user:not found"});
            }
        });
    });

    // 見ているページ確認とヒット判定
    socket.on('watching_page', function(data) {
        console.log("[watching_page]"+data.name+":"+data.page);

        // まずはアクセスしてきたユーザが見ているページを登録
        Page.findOne({user: data.name}, "user", function(err, page) {
            if (err !== null) {
                console.error("error:"+err);
                socket.json.emit('error', {text:"error:"+err});
                return;
            }

            var session_id = socket.id;
            var now = new Date().getTime();

            if (page !== null) {
                // 過去に見ていたページがある場合はアップデート
                page.url_hash = data.page;
                page.timestamp = now;
                page.session_id = session_id;
                page.status = "connect";
                page.save(function(err) {
                    if (err !== null) {
                        console.error("error:"+err);
                        socket.json.emit('error', {text:"error:"+err});
                        return;
                    }
                });

            } else {
                // 過去に見ていたページがない場合は新規登録
                var new_page = new Page({
                    user: data.name,
                    url_hash: data.page,
                    timestamp: now,
                    session_id: session_id,
                    status: "connect"
                });
                new_page.save(function(err) {
                    if (err !== null) {
                        console.error("error:"+err);
                        socket.json.emit('error', {text:"error:"+err});
                        return;
                    }
                });
            }

            // 同じページを見ている人を探す
            // 時間的に近い人を優先するため、timestampの逆順でソート
            Page.find({url_hash: data.page, status: "connect"}, "user url_hash timestamp session_id", {sort: {"timestamp": -1}}, function(err, pages) {
                if (err !== null) {
                    console.error("error:"+err);
                    socket.json.emit('error', {text:"error:"+err});
                    return;
                }

                for (var i in pages) {
                    var page = pages[i];

                    // 自分自身ははじく
                    if (page.user === data.name) {
                        continue;
                    }

                    // 古すぎるものもはじく (単位はms)
                    if (now - page.timestamp > 3600000) {
                        break;
                    }

                    console.log("[butsukatta]"+data.name+"<=>"+page.user);

                    // ぶつかった情報を登録
                    // ぶつかった方
                    CrashUser.findOne({user: data.name}, "user", function(err, user) {
                        if (err !== null) {
                            console.error("error:"+err);
                            socket.json.emit('error', {text:"error:"+err});
                            return;
                        }

                        if (user !== null) {
                            // 新規登録
                            user.crash_id = session_id+page.session_id; // TODO 適当なので後で直す
                            user.aite = page.user;
                            user.user_session = session_id;
                            user.aite_session = page.session_id;
                            user.save(function(err) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }
                            });
                        } else {
                            // アップデート
                            var crash_user = new CrashUser({
                                user: data.name,
                                aite: page.user,
                                user_session: session_id,
                                aite_session: page.session_id,
                                crash_id: session_id+page.session_id, // TODO 適当なので後で直す
                            });
                            crash_user.save(function(err) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }
                            });
                        }
                    });
                    // ぶつかられた方
                    CrashUser.findOne({user: page.user}, "user", function(err, user) {
                        if (err !== null) {
                            console.error("error:"+err);
                            socket.json.emit('error', {text:"error:"+err});
                            return;
                        }

                        if (user !== null) {
                            user.crash_id = session_id+page.session_id; // TODO 適当なので後で直す
                            user.aite = data.name;
                            user.user_session = page.session_id;
                            user.aite_session = session_id;
                            user.save(function(err) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }
                            });
                        } else {
                            var crashed_user = new CrashUser({
                                user: page.user,
                                aite: data.name,
                                user_session: page.session_id,
                                aite_session: session_id,
                                crash_id: session_id+page.session_id, // TODO 適当なので後で直す
                            });
                            crashed_user.save(function(err) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }
                            });
                        }
                    });

                    // ぶつかった情報
                    Crash.findOne({crash_id: session_id+page.session_id}, "crash_id", function(err, crash) {
                        if (err !== null) {
                            console.error("error:"+err);
                            socket.json.emit('error', {text:"error:"+err});
                            return;
                        }

                        if (crash !== null) {
                            crash.timestamp = now;
                            crash.status = 'hit';
                            crash.save(function(err) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }
                            });
                        } else {
                            var crash = new Crash({
                                crash_id: session_id+page.session_id, // TODO 適当なので後で直す
                                timestamp: now,
                                status: 'hit'
                            });
                            crash.save(function(err) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }
                            });
                        }
                    });

                    // アクセスしてきた人に返す
                    socket.json.emit("hit", {text: "hit!!"});
                    // ぶつかった人に返す
                    io.sockets.socket(page.session_id).json.emit("hitted", {text: "hitted!!"});

                    return;
                }
            });
        });
    });

    // ぶつかる開始
    socket.on('crash', function(data) {
        console.log("[crash]"+data.name);

        CrashUser.findOne({user: data.name}, "user aite crash_id user_session aite_session", function(err, user) {
            if (err !== null) {
                console.error("error:"+err);
                socket.json.emit('error', {text:"error:"+err});
                return;
            }

            var session_id = socket.id;
            var now = new Date().getTime();

            if (user === null) {
                socket.json.emit("nocrash", {text: "zannen"});
                return;
            } else {
                Crash.findOne({crash_id: user.crash_id}, "crash_id user aite status", function(err, crash) {
                    if (err !== null) {
                        console.error("error:"+err);
                        socket.json.emit('error', {text:"error:"+err});
                        return;
                    }

                    if (crash === null) {
                        socket.json.emit("nocrash", {text: "zannen"});
                        return;
                    } else {
                        if (crash.status === 'crash') {
                            crash.status = 'crashed';
                            crash.save(function(err) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }
                            });

                            // 再会情報を登録
                            // 再会した方
                            ReunionUser.findOne({user: data.name}, "user aite user_session aite_session", function(err, r_user) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }

                                if (r_user !== null) {
                                    r_user.reunion_id = session_id+user.aite_session; // TODO 適当なので後で直す
                                    r_user.aite = user.aite;
                                    r_user.user_session = session_id;
                                    r_user.aite_session = user.aite_session;
                                    r_user.save(function(err) {
                                        if (err !== null) {
                                            console.error("error:"+err);
                                            socket.json.emit('error', {text:"error:"+err});
                                            return;
                                        }
                                    });
                                } else {
                                    var reunion_user = new ReunionUser({
                                        user: data.name,
                                        aite: user.aite,
                                        user_session: session_id,
                                        aite_session: user.aite_session,
                                        reunion_id: session_id+user.aite_session, // TODO 適当なので後で直す
                                    });
                                    reunion_user.save(function(err) {
                                        if (err !== null) {
                                            console.error("error:"+err);
                                            socket.json.emit('error', {text:"error:"+err});
                                            return;
                                        }
                                    });
                                }
                            });
                            // 再会された方
                            ReunionUser.findOne({user: crash.aite}, "user aite user_session aite_session", function(err, r_user) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }

                                if (r_user !== null) {
                                    r_user.reunion_id = session_id+user.aite_session; // TODO 適当なので後で直す
                                    r_user.aite = data.name;
                                    r_user.user_session = user.aite_session;
                                    r_user.aite_session = session_id;
                                    r_user.save(function(err) {
                                        if (err !== null) {
                                            console.error("error:"+err);
                                            socket.json.emit('error', {text:"error:"+err});
                                            return;
                                        }
                                    });
                                } else {
                                    var reunioned_user = new ReunionUser({
                                        user: user.aite,
                                        aite: data.name,
                                        user_session: user.aite_session,
                                        aite_session: session_id,
                                        reunion_id: session_id+user.aite_session, // TODO 適当なので後で直す
                                    });
                                    reunioned_user.save(function(err) {
                                        if (err !== null) {
                                            console.error("error:"+err);
                                            socket.json.emit('error', {text:"error:"+err});
                                            return;
                                        }
                                    });
                                }
                            });

                            // 再会した情報
                            Reunion.findOne({reunion_id: session_id+user.aite_session}, "reunion_id timestamp status", function(err, reunion) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }

                                if (reunion !== null) {
                                    reunion.timestamp = now;
                                    reunion.status = 'crash';
                                    reunion.save(function(err) {
                                        if (err !== null) {
                                            console.error("error:"+err);
                                            socket.json.emit('error', {text:"error:"+err});
                                            return;
                                        }
                                    });
                                } else {
                                    var reunion = new Reunion({
                                        reunion_id: session_id+user.aite_session, // TODO 適当なので後で直す
                                        timestamp: now,
                                        status: 'crash'
                                    });
                                    reunion.save(function(err) {
                                        if (err !== null) {
                                            console.error("error:"+err);
                                            socket.json.emit('error', {text:"error:"+err});
                                            return;
                                        }
                                    });
                                }

                                console.log("[crashed]"+data.name+":"+user.aite);
                                io.sockets.socket(user.user_session).json.emit("crash", {text: "reunion!!"});
                                io.sockets.socket(user.aite_session).json.emit("crashed", {text: "reunioned!!"});
                            });

                        } else if (crash.status === 'hit') {
                            // まだ片方だけ
                            crash.status = 'crash';
                            crash.save(function(err) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }
                            });
                        }
                    }
                });
            }
        });
    });

    // 同じページを見ていた人が再会
    socket.on('reunion', function(data) {
        console.log("[reunion]"+data.name);

        ReunionUser.findOne({user: data.name}, "user aite reunion_id user_session aite_session", function(err, user) {
            if (err !== null) {
                console.error("error:"+err);
                socket.json.emit('error', {text:"error:"+err});
                return;
            }

            if (user === null) {
                socket.json.emit("noreunion", {text: "zannen"});
                return;
            } else {
                Reunion.findOne({reunion_id: user.reunion_id}, "reunion_id answer status", function(err, reunion) {
                    if (err !== null) {
                        console.error("error:"+err);
                        socket.json.emit('error', {text:"error:"+err});
                        return;
                    }

                    if (reunion === null) {
                        socket.json.emit("noreunion", {text: "zannen"});
                        return;
                    } else {
                        if (reunion.status == 'reunion') {
                            console.log("[reunion:answer]"+reunion.answer+"="+data.answer);
                            if (reunion.answer === data.answer) {
                                console.log("[reunion:success]"+data.name);
                                // 再会実現
                                reunion.status = 'reunioned';
                                reunion.save(function(err) {
                                    if (err !== null) {
                                        console.error("error:"+err);
                                        socket.json.emit('error', {text:"error:"+err});
                                        return;
                                    }
                                });

                                // アクセスしてきた人に相手情報を返す
                                User.findOne({name: user.aite}, "name gender profile", function(err, r_user) {
                                    if (err !== null) {
                                        console.error("error:"+err);
                                        socket.json.emit('error', {text:"error:"+err});
                                        return;
                                    }

                                    io.sockets.socket(user.user_session).json.emit("reunion", {text: "reunion!!", profile: r_user.profile, gender: r_user.gender});
                                });

                                // ぶつかった人に自分情報を返す
                                User.findOne({name: user.user}, "name gender profile", function(err, r_user) {
                                    if (err !== null) {
                                        console.error("error:"+err);
                                        socket.json.emit('error', {text:"error:"+err});
                                        return;
                                    }

                                    io.sockets.socket(user.aite_session).json.emit("reunion", {text: "reunion!!", profile: r_user.profile, gender: r_user.gender});
                                });
                            } else {
                                reunion.status = 'no reunion';
                                reunion.save(function(err) {
                                    if (err !== null) {
                                        console.error("error:"+err);
                                        socket.json.emit('error', {text:"error:"+err});
                                        return;
                                    }
                                });

                                // アクセスしてきた人に相手情報を返す
                                // 答えが違う
                                io.sockets.socket(user.user_session).json.emit("noreunion", {text: "zannen"});
                                io.sockets.socket(user.aite_session).json.emit("noreunion", {text: "zannen"});
                            }

                        } else if (reunion.status === 'crash') {
                            console.log("[reunion:one]"+data.name);
                            // まだ片方だけ
                            reunion.status = 'reunion';
                            reunion.answer = data.answer;
                            reunion.save(function(err) {
                                if (err !== null) {
                                    console.error("error:"+err);
                                    socket.json.emit('error', {text:"error:"+err});
                                    return;
                                }
                            });

                        } else {
                            socket.json.emit("noreunion", {text: "zannen"});
                        }
                    }
                });
            }
        });
    });
});
