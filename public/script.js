// Connect to the backend
// Change this URL to your Render URL after deployment!
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3000' 
    : 'https://blackjack-background2.onrender.com';

const socket = io(SERVER_URL);

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('playerName');
const roomIdInput = document.getElementById('roomId');
const sipsBetInput = document.getElementById('sipsBet');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const lobbyError = document.getElementById('lobbyError');
const powersEnabledCheckbox = document.getElementById('powersEnabled');
const powersToggleContainer = document.getElementById('powersToggleContainer');

const roomNameDisplay = document.getElementById('roomNameDisplay');
const sipsBetDisplay = document.getElementById('sipsBetDisplay');
const notificationZone = document.getElementById('notification-zone');
const othersBanner = document.getElementById('othersBanner');

const dealerArea = document.querySelector('.dealer-area');
const dealerHandEl = document.getElementById('dealerHand');
const dealerScoreEl = document.getElementById('dealerScore');

const myArea = document.getElementById('myArea');
const myHandEl = document.getElementById('myHand');
const myScoreEl = document.getElementById('myScore');
const btnStart = document.getElementById('btnStart');
const btnHit = document.getElementById('btnHit');
const btnStand = document.getElementById('btnStand');
const btnDouble = document.getElementById('btnDouble');
const distributionZone = document.getElementById('distributionZone');
const sipsToDistributeCount = document.getElementById('sipsToDistributeCount');
const btnDiscardSips = document.getElementById('btnDiscardSips');

const powerZone = document.getElementById('powerZone');
const powerToggleBtn = document.getElementById('powerToggleBtn');
const powerDetails = document.getElementById('powerDetails');
const powerTitle = document.getElementById('powerTitle');
const powerDescription = document.getElementById('powerDescription');
const lacheTargetContainer = document.getElementById('lacheTargetContainer');
const lacheTargetSelect = document.getElementById('lacheTargetSelect');
const btnUseLache = document.getElementById('btnUseLache');

// Toggle power details on emoji click
powerToggleBtn.addEventListener('click', () => {
    powerDetails.classList.toggle('hidden');
});

// Close details when clicking elsewhere (unless lâche MUST pick a target)
document.addEventListener('click', (e) => {
    if (!powerZone.contains(e.target) && !powerZone.classList.contains('forced-open')) {
        powerDetails.classList.add('hidden');
    }
});

const POWER_INFO = {
    'lache': { title: 'Le Lâche', desc: "Désignez votre victime : si vous perdez, elle boira votre mise à votre place." },
    'intouchable': { title: 'L\'Intouchable', desc: "Immunité totale. 0 gorgée, et personne ne peut vous distribuer de gorgée." },
    'tricheur': { title: 'Le Tricheur', desc: "Vous pouvez voir la carte cachée du croupier !" },
    'gambler': { title: 'Le Gambler', desc: "Vous êtes le seul à la table à pouvoir Doubler (x2) votre mise." },
    'videur': { title: 'Le Videur', desc: "Si un gagnant tente de vous donner une gorgée, elle retourne à l'envoyeur." }
};

// Toggle powers event
powersEnabledCheckbox.addEventListener('change', () => {
    socket.emit('togglePowers', { enabled: powersEnabledCheckbox.checked });
});


// Lobby actions
btnCreateRoom.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim() || 'Joueur';
    const roomId = roomIdInput.value.trim();
    const sipsBet = parseInt(sipsBetInput.value) || 5;

    if (!roomId) {
        lobbyError.textContent = "Veuillez entrer un nom de salle.";
        return;
    }
    socket.emit('createRoom', { roomId, playerName, sipsBet });
});

btnJoinRoom.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim() || 'Joueur';
    const roomId = roomIdInput.value.trim();

    if (!roomId) {
        lobbyError.textContent = "Veuillez entrer un nom de salle.";
        return;
    }
    socket.emit('joinRoom', { roomId, playerName });
});

socket.on('errorMsg', (msg) => {
    lobbyError.textContent = msg;
});

let previousHandLengths = {};

// Game state update
socket.on('updateState', (state) => {
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    roomNameDisplay.textContent = state.id;
    sipsBetDisplay.textContent = state.sipsBet;

    // Powers toggle visibility/availability
    const isCreator = state.players.length > 0 && state.players[0].id === socket.id;
    powersEnabledCheckbox.checked = state.powersEnabled;
    powersEnabledCheckbox.disabled = !isCreator;
    // Hide toggle if already playing (though it's in the lobby screen, better be safe)
    if (state.gameState !== 'lobby') {
        powersToggleContainer.style.display = 'none';
    } else {
        powersToggleContainer.style.display = 'flex';
    }

    // Reset animations cache if we went back to lobby
    if (state.gameState === 'lobby') {
        previousHandLengths = {};
    }

    renderDealer(state);
    renderMe(state);
    renderOtherPlayers(state);
    renderCheatMenu(state);
    handleGameState(state);
});

function getSuitSymbol(suit) {
    switch(suit) {
        case 'hearts': return '♥';
        case 'diamonds': return '♦';
        case 'clubs': return '♣';
        case 'spades': return '♠';
        default: return '';
    }
}

function getSuitColorClass(suit) {
    if (suit === 'hearts' || suit === 'diamonds') return 'red';
    return 'black';
}

function updateCardDisplay(cardElement, cardData) {
    if (cardData.suit === 'hidden') {
        cardElement.className = 'card hidden-card card-dealt';
        cardElement.innerHTML = '';
        return;
    }

    const symbol = getSuitSymbol(cardData.suit);
    const colorClass = getSuitColorClass(cardData.suit);
    
    // Base class with dynamic color
    cardElement.className = `card ${colorClass}`;
    cardElement.innerHTML = `
        <div class="card-top-left">${cardData.value}</div>
        <div class="card-suit">${symbol}</div>
        <div class="card-bottom-right">${cardData.value}</div>
    `;
}

function renderHand(handArray, containerEl, entityId) {
    containerEl.innerHTML = '';
    const prevLen = previousHandLengths[entityId] || 0;

    handArray.forEach((card, index) => {
        const cardEl = document.createElement('div');
        updateCardDisplay(cardEl, card);
        
        // Add animation class if card is new or if it's initial deal
        if (index >= prevLen || prevLen === 0) {
            cardEl.classList.add('card-dealt');
        }
        
        containerEl.appendChild(cardEl);
    });

    previousHandLengths[entityId] = handArray.length;
}

function renderDealer(state) {
    dealerScoreEl.textContent = state.dealerScore;
    renderHand(state.dealerHand, dealerHandEl, 'dealer');
}

function renderMe(state) {
    const me = state.players.find(p => p.id === myId);
    if (!me) return;

    myScoreEl.textContent = me.score;
    renderHand(me.hand, myHandEl, myId);

    // Active Turn highlighting
    if (state.currentTurnPlayerId === myId && state.gameState === 'playing') {
        myArea.classList.add('active-turn');
    } else {
        myArea.classList.remove('active-turn');
    }

    // Distribution Phase Highlighting
    if (state.gameState === 'distributing_sips') {
        if (me.sipsToDistribute > 0) {
            distributionZone.classList.remove('hidden');
            sipsToDistributeCount.textContent = me.sipsToDistribute;
        } else {
            distributionZone.classList.add('hidden');
        }
    } else {
        distributionZone.classList.add('hidden');
    }

    // Power UI
    if (me.power) {
        const info = POWER_INFO[me.power];
        const powerEmojis = { lache: '🏃', intouchable: '🛡️', tricheur: '👁️', gambler: '🎲', videur: '🚪' };
        powerToggleBtn.textContent = powerEmojis[me.power] || '✨';
        powerZone.classList.remove('hidden');
        if (info) {
            powerTitle.textContent = info.title;
            powerDescription.textContent = info.desc;
        }

        const isLacheTurn = me.power === 'lache' && !me.powerTarget 
                         && state.gameState === 'playing' 
                         && state.currentTurnPlayerId === myId
                         && me.status === 'playing';

        // For Le Lâche: auto-open the popup AND lock it open until target is picked
        if (isLacheTurn) {
            powerZone.classList.add('forced-open');
            powerDetails.classList.remove('hidden');
            lacheTargetContainer.classList.remove('hidden');
            const others = state.players.filter(p => p.id !== myId);
            lacheTargetSelect.innerHTML = '';
            others.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.id;
                opt.textContent = o.name;
                lacheTargetSelect.appendChild(opt);
            });
            btnUseLache.disabled = others.length === 0;
        } else {
            powerZone.classList.remove('forced-open');
            lacheTargetContainer.classList.add('hidden');
        }
    } else {
        powerZone.classList.add('hidden');
        powerDetails.classList.add('hidden');
    }

    // Action Buttons
    btnStart.classList.add('hidden');
    btnHit.classList.add('hidden');
    btnStand.classList.add('hidden');
    btnDouble.classList.add('hidden');

    if (state.gameState === 'lobby') {
        btnStart.classList.remove('hidden');
    } else if (state.gameState === 'playing' && state.currentTurnPlayerId === myId && me.status === 'playing') {
        const mustPickTarget = me.power === 'lache' && !me.powerTarget && state.players.length > 1;
        if (mustPickTarget) {
            // Buttons stay hidden — player must pick a target first (shown in popup)
        } else {
            btnHit.classList.remove('hidden');
            btnStand.classList.remove('hidden');
            if (me.hand.length === 2 && me.power === 'gambler' && !me.hasDoubled) {
                btnDouble.classList.remove('hidden');
            }
        }
    }

    if (me.status === 'bust') myScoreEl.textContent += ' (Bust)';
}

function renderOtherPlayers(state) {
    othersBanner.innerHTML = '';
    const others = state.players.filter(p => p.id !== myId);

    if (others.length === 0) {
        othersBanner.style.display = 'none';
        return;
    }
    othersBanner.style.display = 'flex';

    others.forEach(player => {
        const box = document.createElement('div');
        box.className = 'mini-player';
        
        if (state.currentTurnPlayerId === player.id && state.gameState === 'playing') {
            box.classList.add('active-turn');
        }

        let statusText = player.status;
        let badgeClass = player.status === 'bust' || player.status === 'stand' || player.status === 'playing' ? player.status : '';
        let immuneHtml = player.consecutiveLosses >= 3 ? `<span class="immune-badge">🛡️ Immunisé</span>` : '';
        
        let html = `
            <div class="mini-header">
                <span>${player.name} ${immuneHtml}</span>
                <span class="status-badge ${badgeClass}">${statusText}</span>
            </div>
            <div class="mini-score">Score: ${player.score}</div>
            <div class="mini-cards"></div>
        `;
        
        box.innerHTML = html;
        const cardsDiv = box.querySelector('.mini-cards');
        
        player.hand.forEach(card => {
            const cardEl = document.createElement('div');
            if (card.suit === 'hidden') {
                cardEl.className = 'mini-card hidden-card';
            } else {
                cardEl.className = 'mini-card ' + getSuitColorClass(card.suit);
                cardEl.textContent = card.value + getSuitSymbol(card.suit);
            }
            cardsDiv.appendChild(cardEl);
        });

        const me = state.players.find(p => p.id === myId);

        // Distribution buttons
        if (state.gameState === 'distributing_sips' && me && me.sipsToDistribute > 0) {
            if (player.consecutiveLosses < 3) {
                const btnGiveSip = document.createElement('button');
                btnGiveSip.className = 'distribute-btn';
                btnGiveSip.textContent = '+1 Gorgée';
                btnGiveSip.onclick = () => socket.emit('distributeSip', player.id);
                box.appendChild(btnGiveSip);
            }
        }

        if (state.gameState === 'drinking_check' && player.needsToDrink) {
            const btnValidate = document.createElement('button');
            btnValidate.className = 'btn secondary';
            btnValidate.style.padding = '4px 8px';
            btnValidate.style.fontSize = '0.75rem';
            btnValidate.style.marginTop = '8px';
            btnValidate.textContent = "Il a bu ! (" + player.validations + "/" + state.requiredValidations + ")";
            btnValidate.onclick = () => socket.emit('validateDrink', player.id);
            box.appendChild(btnValidate);
        }

        othersBanner.appendChild(box);
    });
}

function handleGameState(state) {
    notificationZone.classList.add('hidden');
    notificationZone.innerHTML = '';

    const me = state.players.find(p => p.id === myId);

    if (state.gameState === 'distributing_sips') {
        if (me && me.sipsToDistribute <= 0) {
            notificationZone.classList.remove('hidden');
            notificationZone.innerHTML = `⌛ En attente de la distribution des gorgées...`;
        }
    } else if (state.gameState === 'drinking_check') {
        const losers = state.players.filter(p => p.needsToDrink);
        if (losers.length > 0) {
            notificationZone.classList.remove('hidden');
            let notifs = [];
            losers.forEach(loser => {
                if (loser.id === myId) {
                    notifs.push(`🍷 Vous devez boire <strong>${loser.sipsToDrink}</strong> gorgée(s) ! (Validations: ${loser.validations}/${state.requiredValidations})`);
                } else {
                    notifs.push(`⌛ En attente que <strong>${loser.name}</strong> boive ses ${loser.sipsToDrink} gorgées...`);
                }
            });
            notificationZone.innerHTML = notifs.join('<br>');
            btnStart.classList.add('hidden');
        }
    }
}

const cheatToggleBtn = document.getElementById('cheatToggleBtn');
const cheatMenu = document.getElementById('cheatMenu');
const cheatLuckyRafou = document.getElementById('cheatLuckyRafou');
const cheatUnluckyList = document.getElementById('cheatUnluckyList');

cheatToggleBtn.addEventListener('click', () => {
    cheatMenu.classList.toggle('hidden');
});

cheatLuckyRafou.addEventListener('change', (e) => {
    socket.emit('toggleCheat', { type: 'luckyRafou', targetId: null, active: e.target.checked });
});

function renderCheatMenu(state) {
    const me = state.players.find(p => p.id === myId);
    if (me && me.name.toLowerCase() === 'rafou') {
        cheatToggleBtn.classList.remove('hidden');
        
        cheatLuckyRafou.checked = state.cheats.luckyRafou;
        
        cheatUnluckyList.innerHTML = '';
        const others = state.players.filter(p => p.id !== myId);
        if (others.length === 0) {
            cheatUnluckyList.innerHTML = '<small style="color:#64748b">Aucun autre joueur</small>';
        } else {
            others.forEach(other => {
                const isUnlucky = state.cheats.unluckyPlayers.includes(other.id);
                const label = document.createElement('label');
                label.className = 'cheat-label';
                label.innerHTML = `<input type="checkbox" ${isUnlucky ? 'checked' : ''} /> ${other.name}`;
                
                label.querySelector('input').addEventListener('change', (e) => {
                    socket.emit('toggleCheat', { type: 'unlucky', targetId: other.id, active: e.target.checked });
                });
                cheatUnluckyList.appendChild(label);
            });
        }
    } else {
        cheatToggleBtn.classList.add('hidden');
        cheatMenu.classList.add('hidden');
    }
}

// Game actions
btnStart.addEventListener('click', () => {
    socket.emit('startGame');
});

btnHit.addEventListener('click', () => {
    socket.emit('hit');
});

btnStand.addEventListener('click', () => {
    socket.emit('stand');
});

btnDouble.addEventListener('click', () => {
    socket.emit('doubleDown');
});

btnDiscardSips.addEventListener('click', () => {
    socket.emit('finishDistribution');
});

btnUseLache.addEventListener('click', () => {
    const targetId = lacheTargetSelect.value;
    if (targetId) {
        socket.emit('usePower', targetId);
    }
});
