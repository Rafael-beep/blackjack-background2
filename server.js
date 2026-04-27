const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Game State
const rooms = {};

const createDeck = () => {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    for (let suit of suits) {
        for (let value of values) {
            let weight = parseInt(value);
            if (value === 'J' || value === 'Q' || value === 'K') weight = 10;
            if (value === 'A') weight = 11;
            deck.push({ suit, value, weight });
        }
    }
    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
};

const calculateScore = (hand) => {
    let score = 0;
    let aces = 0;
    for (let card of hand) {
        score += card.weight;
        if (card.value === 'A') aces += 1;
    }
    while (score > 21 && aces > 0) {
        score -= 10;
        aces -= 1;
    }
    return score;
};


const broadcastUpdate = (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    console.log(`[BROADCAST] Room ${roomId}: ${room.players.length} players`);
    for (const player of room.players) {
        io.to(player.id).emit('updateState', getPublicRoomState(room, player.id));
    }
};

const nextTurn = (roomId) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'playing') return;

    // Find current index
    let currentIndex = -1;
    if (room.currentTurnPlayerId !== 'dealer' && room.currentTurnPlayerId !== null) {
        currentIndex = room.players.findIndex(p => p.id === room.currentTurnPlayerId);
    }

    // Find next playing player
    let nextPlayer = null;
    for (let i = currentIndex + 1; i < room.players.length; i++) {
        if (room.players[i].status === 'playing') {
            nextPlayer = room.players[i];
            break;
        }
    }

    if (nextPlayer) {
        room.currentTurnPlayerId = nextPlayer.id;
        broadcastUpdate(roomId);
    } else {
        // No players left to play, dealer's turn
        room.currentTurnPlayerId = 'dealer';
        broadcastUpdate(roomId); // Show dealer's hidden card first
        playDealerTurn(roomId);
    }
};

const playDealerTurn = async (roomId) => {
    const room = rooms[roomId];
    let dealerScore = calculateScore(room.dealerHand);
    
    const drawCard = async () => {
        // Safety check if room still exists and game state is playing
        if (!rooms[roomId] || rooms[roomId].gameState !== 'playing') return;
        
        if (dealerScore < 17) {
            await new Promise(r => setTimeout(r, 1000)); // 1 second delay for animation
            room.dealerHand.push(room.deck.pop());
            dealerScore = calculateScore(room.dealerHand);
            broadcastUpdate(roomId);
            await drawCard();
        } else {
            evaluateRound(roomId);
        }
    };

    // Small initial delay before dealer starts drawing
    await new Promise(r => setTimeout(r, 1000));
    await drawCard();
};

const checkDrinkingPhase = (roomId) => {
    const room = rooms[roomId];
    
    // Set needsToDrink boolean for frontend validation logic
    room.players.forEach(p => {
        if (p.sipsToDrink > 0) {
            p.needsToDrink = true;
        }
    });

    const anyoneNeedsToDrink = room.players.some(p => p.needsToDrink);
    
    if (anyoneNeedsToDrink) {
        room.gameState = 'drinking_check';
        room.requiredValidations = room.players.length > 2 ? 2 : 1;
        room.currentTurnPlayerId = null;
    } else {
        room.gameState = 'lobby';
        room.currentTurnPlayerId = null;
        room.players.forEach(p => {
            p.hand = [];
            p.score = 0;
            p.status = 'waiting';
        });
        room.dealerHand = [];
    }
}

const evaluateRound = (roomId) => {
    const room = rooms[roomId];
    const dealerScore = calculateScore(room.dealerHand);
    const dealerBust = dealerScore > 21;

    let hasWinners = false;

    // First pass: Calculate wins/losses and base sips
    room.players.forEach(p => {
        const isBlackjack = p.score === 21 && p.hand.length === 2;
        const bet = p.currentBet || room.sipsBet;

        if (p.status === 'bust' || (!dealerBust && dealerScore > p.score)) {
            p.consecutiveLosses += 1;
            p.sipsToDrink += bet;
        } else if (!dealerBust && dealerScore === p.score) {
            // Push (draw) - no base sip
            p.consecutiveLosses = 0;
        } else {
            // Winner
            p.consecutiveLosses = 0;
            p.sipsToDistribute = isBlackjack ? Math.ceil(bet * 1.5) : bet;
            hasWinners = true;
        }
    });

    // Second pass: Powers logic (Lache)
    room.players.forEach(p => {
        if (p.power === 'lache' && p.sipsToDrink > 0 && p.powerTarget) {
            const target = room.players.find(t => t.id === p.powerTarget);
            if (target) {
                target.sipsToDrink += p.sipsToDrink;
                p.sipsToDrink = 0;
            }
        }
    });

    // Third pass: Powers logic (Intouchable)
    room.players.forEach(p => {
        if (p.power === 'intouchable') {
            p.sipsToDrink = 0;
        }
    });

    if (hasWinners) {
        room.gameState = 'distributing_sips';
        room.currentTurnPlayerId = null;
    } else {
        checkDrinkingPhase(roomId);
    }

    broadcastUpdate(roomId);
};

function drawSpecificCard(deck, conditionFn) {
    const index = deck.findIndex(conditionFn);
    if (index !== -1) {
        return deck.splice(index, 1)[0];
    }
    return deck.pop(); // Fallback if no card matches
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', ({ roomId, playerName, sipsBet }) => {
        const rId = roomId.toLowerCase().trim();
        if (rooms[rId]) {
            socket.emit('errorMsg', 'La salle existe déjà.');
            return;
        }
        
        console.log(`[CREATE] Room: ${rId} by ${playerName}`);
        
        rooms[rId] = {
            id: rId,
            sipsBet: sipsBet,
            players: [],
            dealerHand: [],
            deck: [],
            gameState: 'lobby', // lobby, playing, distributing_sips, drinking_check
            currentTurnPlayerId: null,
            requiredValidations: 0,
            cheats: {
                luckyRafou: false,
                unluckyPlayers: []
            },
            powersEnabled: true,
            proposedGages: [],
            gageTargetPlayerId: null,
            lastGageResult: null // Store result here
        };

        joinRoom(socket, roomId, playerName);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const rId = roomId.toLowerCase().trim();
        if (!rooms[rId]) {
            console.log(`[JOIN FAIL] Room ${rId} not found for ${playerName}`);
            socket.emit('errorMsg', 'La salle n\'existe pas.');
            return;
        }
        if (rooms[rId].gameState !== 'lobby') {
            socket.emit('errorMsg', 'Partie déjà en cours.');
            return;
        }
        console.log(`[JOIN] Room: ${rId} user: ${playerName}`);
        joinRoom(socket, rId, playerName);
    });

    socket.on('togglePowers', ({ enabled }) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        // Only the first player (creator) can toggle
        if (room.players.length > 0 && room.players[0].id === socket.id) {
            room.powersEnabled = enabled;
            broadcastUpdate(roomId);
        }
    });

    const joinRoom = (socket, roomId, playerName) => {
        const room = rooms[roomId];
        const player = {
            id: socket.id,
            name: playerName,
            hand: [],
            score: 0,
            status: 'waiting',
            needsToDrink: false,
            sipsToDrink: 0,
            sipsToDistribute: 0,
            receivedSips: 0,
            consecutiveLosses: 0,
            validations: 0,
            hasValidated: [] 
        };
        room.players.push(player);
        socket.join(roomId);
        socket.roomId = roomId;
        
        broadcastUpdate(roomId);
    };

    socket.on('startGame', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        // Setup new round
        room.deck = createDeck();
        room.dealerHand = [];
        room.gameState = 'playing';
        room.currentTurnPlayerId = null;
        room.proposedGages = [];
        room.gageTargetPlayerId = null;
        
        // Setup players
        const powers = ['lache', 'intouchable', 'tricheur', 'gambler', 'videur'];
        room.players.forEach(p => {
            p.hand = [];
            p.score = 0;
            p.status = 'playing';
            p.needsToDrink = false;
            p.sipsToDrink = 0;
            p.sipsToDistribute = 0;
            p.receivedSips = 0;
            p.validations = 0;
            p.hasValidated = [];
            p.currentBet = room.sipsBet;
            p.hasDoubled = false;
            // p.consecutiveLosses = 0; // REMOVED: Must persist until win
            
            // Power Assignment: 40% chance if enabled
            p.power = null;
            p.powerTarget = null;
            if (room.powersEnabled && Math.random() < 0.4) {
                p.power = powers[Math.floor(Math.random() * powers.length)];
            }
        });
        
        // 1. Dealer initial hand
        if (room.cheats.luckyRafou) {
            // Force dealer to have a low score initially (e.g. 5 and 10 = 15)
            room.dealerHand.push(drawSpecificCard(room.deck, c => c.weight === 10));
            room.dealerHand.push(drawSpecificCard(room.deck, c => c.weight >= 4 && c.weight <= 6));
        } else {
            room.dealerHand = [room.deck.pop(), room.deck.pop()];
        }

        // 2. Players initial hands
        room.players.forEach(p => {
            const isRafou = p.name.toLowerCase() === 'rafou';
            const isUnlucky = room.cheats.unluckyPlayers.includes(p.id);

            if (isRafou && room.cheats.luckyRafou) {
                // Rafou gets exactly 20
                p.hand.push(drawSpecificCard(room.deck, c => c.weight === 10));
                p.hand.push(drawSpecificCard(room.deck, c => c.weight === 10));
            } else if (isUnlucky) {
                // Unlucky gets 15 or 16
                p.hand.push(drawSpecificCard(room.deck, c => c.weight === 10));
                p.hand.push(drawSpecificCard(room.deck, c => c.weight === 5 || c.weight === 6));
            } else {
                p.hand.push(room.deck.pop(), room.deck.pop());
            }

            p.score = calculateScore(p.hand);
            p.status = p.score === 21 ? 'stand' : 'playing';
        });
        
        // Start the turn sequence
        nextTurn(roomId);
    });

    socket.on('hit', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        if (room.gameState !== 'playing' || room.currentTurnPlayerId !== socket.id) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.status === 'playing') {
            const isUnlucky = room.cheats.unluckyPlayers.includes(player.id);
            if (isUnlucky) {
                player.hand.push(drawSpecificCard(room.deck, c => c.weight === 10)); // Force bust
            } else {
                player.hand.push(room.deck.pop());
            }

            player.score = calculateScore(player.hand);
            if (player.score >= 21) {
                player.status = player.score === 21 ? 'stand' : 'bust';
                broadcastUpdate(roomId);
                nextTurn(roomId); // Next player's turn
            } else {
                broadcastUpdate(roomId);
            }
        }
    });

    socket.on('doubleDown', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        if (room.gameState !== 'playing' || room.currentTurnPlayerId !== socket.id) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.status === 'playing' && player.hand.length === 2 && player.power === 'gambler' && !player.hasDoubled) {
            // Just double the bet — no forced card, player continues normally
            player.currentBet = (player.currentBet || room.sipsBet) * 2;
            player.hasDoubled = true;
            broadcastUpdate(roomId);
        }
    });

    socket.on('finishDistribution', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        if (room.gameState !== 'distributing_sips') return;

        const giver = room.players.find(p => p.id === socket.id);
        if (giver) {
            giver.sipsToDistribute = 0;
            const stillDistributing = room.players.some(p => p.sipsToDistribute > 0);
            if (!stillDistributing) {
                checkDrinkingPhase(roomId);
            }
            broadcastUpdate(roomId);
        }
    });

    socket.on('stand', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        if (room.gameState !== 'playing' || room.currentTurnPlayerId !== socket.id) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.status === 'playing') {
            player.status = 'stand';
            broadcastUpdate(roomId);
            nextTurn(roomId); // Next player's turn
        }
    });

    socket.on('distributeSip', (targetId) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        if (room.gameState !== 'distributing_sips') return;

        const giver = room.players.find(p => p.id === socket.id);
        const target = room.players.find(p => p.id === targetId);

        // Can only give if giver has sips, and target is not immune
        if (giver && target && giver.sipsToDistribute > 0 && target.consecutiveLosses < 3) {
            if (target.power === 'intouchable') {
                // Absorbed by shield
                giver.sipsToDistribute -= 1;
            } else if (target.power === 'videur') {
                // Reflected to giver
                giver.sipsToDistribute -= 1;
                giver.receivedSips += 1;
                giver.sipsToDrink += 1;
            } else {
                giver.sipsToDistribute -= 1;
                target.receivedSips += 1;
                target.sipsToDrink += 1;
            }
            
            const stillDistributing = room.players.some(p => p.sipsToDistribute > 0);
            if (!stillDistributing) {
                checkDrinkingPhase(roomId);
            }
            broadcastUpdate(roomId);
        }
    });

    socket.on('usePower', (targetId) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.power === 'lache') {
            player.powerTarget = targetId;
            broadcastUpdate(roomId);
        }
    });

    socket.on('toggleCheat', ({ type, targetId, active }) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.name.toLowerCase() !== 'rafou') return;

        if (type === 'luckyRafou') {
            room.cheats.luckyRafou = active;
        } else if (type === 'unlucky') {
            if (active) {
                if (!room.cheats.unluckyPlayers.includes(targetId)) {
                    room.cheats.unluckyPlayers.push(targetId);
                }
            } else {
                room.cheats.unluckyPlayers = room.cheats.unluckyPlayers.filter(id => id !== targetId);
            }
        }
        broadcastUpdate(roomId);
    });

    socket.on('validateDrink', (loserId) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        if (room.gameState !== 'drinking_check') return;

        const loser = room.players.find(p => p.id === loserId);
        if (loser && loser.needsToDrink && loser.id !== socket.id && !loser.hasValidated.includes(socket.id)) {
            loser.hasValidated.push(socket.id);
            loser.validations += 1;
            
            if (loser.validations >= room.requiredValidations) {
                loser.needsToDrink = false;
            }
            
            const anyoneNeedsToDrink = room.players.some(p => p.needsToDrink);
            if (!anyoneNeedsToDrink) {
                room.gameState = 'lobby';
                room.currentTurnPlayerId = null;
                room.players.forEach(p => {
                    p.hand = [];
                    p.score = 0;
                    p.status = 'waiting';
                });
                room.dealerHand = [];
            }
            broadcastUpdate(roomId);
        }
    });

    socket.on('chooseGage', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        
        if (player && player.needsToDrink) {
            room.gameState = 'proposing_gages';
            room.gageTargetPlayerId = player.id;
            room.proposedGages = [];
            broadcastUpdate(roomId);
        }
    });

    socket.on('proposeGage', ({ gage }) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        console.log(`[GAGE] Room ${roomId}: Proposal "${gage}" from ${socket.id}`);

        // Target can't propose a gage for themselves
        if (socket.id === room.gageTargetPlayerId) return;
        
        // Prevent multiple proposals from same player
        if (room.proposedGages.some(g => g.playerId === socket.id)) return;

        room.proposedGages.push({
            playerId: socket.id,
            playerName: room.players.find(p => p.id === socket.id)?.name || 'Anonyme',
            text: gage
        });

        broadcastUpdate(roomId);
    });

    socket.on('spinGageRoulette', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        if (room.gameState === 'proposing_gages' && room.proposedGages.length > 0) {
            const winnerGage = room.proposedGages[Math.floor(Math.random() * room.proposedGages.length)];
            
            room.gameState = 'gage_roulette';
            room.lastGageResult = {
                gage: winnerGage.text,
                proposer: winnerGage.playerName,
                targetName: room.players.find(p => p.id === room.gageTargetPlayerId)?.name
            };
            
            broadcastUpdate(roomId);

            // Phase 1: Animation (6s)
            setTimeout(() => {
                if (room.gameState !== 'gage_roulette') return;
                room.gameState = 'gage_result';
                broadcastUpdate(roomId);

                // Phase 2: Result display (5s)
                setTimeout(() => {
                    if (room.gameState !== 'gage_result') return;
                    
                    const target = room.players.find(p => p.id === room.gageTargetPlayerId);
                    if (target) {
                        target.needsToDrink = false;
                        target.sipsToDrink = 0;
                        target.validations = 0;
                        target.hasValidated = [];
                    }
                    
                    const othersDrinking = room.players.filter(p => p.needsToDrink);
                    room.gameState = othersDrinking.length === 0 ? 'lobby' : 'drinking_check';
                    
                    room.proposedGages = [];
                    room.gageTargetPlayerId = null;
                    room.lastGageResult = null;
                    broadcastUpdate(roomId);
                }, 5000);
            }, 6000); 
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            
            // If the disconnected user was playing and it was their turn, skip them
            if (room.gameState === 'playing' && room.currentTurnPlayerId === socket.id) {
                nextTurn(roomId);
            }

            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[roomId];
            } else {
                broadcastUpdate(roomId);
            }
        }
    });
});

const getPublicRoomState = (room, playerId) => {
    let publicDealerHand = room.dealerHand;
    let dealerScore = '?';

    const player = room.players.find(p => p.id === playerId);
    const isTricheur = player && player.power === 'tricheur';

    if (room.gameState === 'playing' && room.currentTurnPlayerId !== 'dealer' && !isTricheur) {
        if (room.dealerHand.length >= 2) {
            publicDealerHand = [room.dealerHand[0], { suit: 'hidden', value: '?' }];
        }
    } else {
        dealerScore = calculateScore(room.dealerHand);
    }

    return {
        id: room.id,
        gameState: room.gameState,
        sipsBet: room.sipsBet,
        currentTurnPlayerId: room.currentTurnPlayerId,
        requiredValidations: room.requiredValidations,
        dealerHand: publicDealerHand,
        dealerScore: dealerScore,
        cheats: room.cheats,
        powersEnabled: room.powersEnabled,
        proposedGages: room.proposedGages,
        gageTargetPlayerId: room.gageTargetPlayerId,
        players: room.players.map(p => {
            const isMe = p.id === playerId;
            return {
                id: p.id,
                name: p.name,
                hand: p.hand,
                score: p.score,
                status: p.status,
                needsToDrink: p.needsToDrink,
                sipsToDrink: p.sipsToDrink,
                sipsToDistribute: p.sipsToDistribute,
                receivedSips: p.receivedSips,
                consecutiveLosses: p.consecutiveLosses,
                validations: p.validations,
                currentBet: p.currentBet,
                power: isMe ? p.power : null,
                powerTarget: isMe ? p.powerTarget : null,
                hasDoubled: isMe ? p.hasDoubled : false
            };
        })
    };
};


server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
