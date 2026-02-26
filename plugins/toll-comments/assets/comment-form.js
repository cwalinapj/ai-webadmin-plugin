(function () {
  const config = window.DDNS_TOLL_COMMENTS_CONFIG || {};
  const connectBtn = document.getElementById('ddns-toll-connect');
  const payBtn = document.getElementById('ddns-toll-pay');
  const statusEl = document.getElementById('ddns-toll-status');
  const walletInput = document.getElementById('ddns-toll-wallet');
  const ticketInput = document.getElementById('ddns-toll-ticket');
  const form = document.getElementById('commentform');

  if (!connectBtn || !payBtn || !walletInput || !ticketInput) return;

  function setStatus(message, type) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.state = type || 'info';
  }

  async function post(path, body) {
    const res = await fetch(`${config.restUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': config.nonce || ''
      },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setStatus('Wallet not detected. Install a wallet like MetaMask.', 'error');
      return;
    }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const wallet = accounts && accounts[0];
    if (!wallet) {
      setStatus('Wallet connection failed.', 'error');
      return;
    }
    const challenge = await post('/challenge', { wallet });
    const message = `ddns-comments-login:${challenge.challenge}`;
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, wallet]
    });
    await post('/verify', { wallet, signature });
    walletInput.value = wallet;
    setStatus(`Wallet connected: ${wallet.slice(0, 6)}...${wallet.slice(-4)}`, 'ok');
  }

  async function payToll() {
    const wallet = walletInput.value;
    if (!wallet) {
      setStatus('Connect your wallet first.', 'error');
      return;
    }
    const response = await post('/hold', { wallet, post_id: config.postId });
    ticketInput.value = response.ticket_id || '';
    if (response.free) {
      setStatus('High-rep wallet: toll waived.', 'ok');
    } else {
      setStatus(`Toll held: ${config.tollAmount} ${config.currencyCode}`, 'ok');
    }
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      connectWallet().catch((err) => setStatus(err.message, 'error'));
    });
  }

  if (payBtn) {
    payBtn.addEventListener('click', () => {
      payToll().catch((err) => setStatus(err.message, 'error'));
    });
  }

  if (form) {
    form.addEventListener('submit', (event) => {
      if (!walletInput.value || !ticketInput.value) {
        event.preventDefault();
        setStatus('Please connect wallet and pay refundable toll before posting.', 'error');
      }
    });
  }
})();
