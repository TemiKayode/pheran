// ─── Currency ─────────────────────────────────────────────────────────────────
function formatCurrency(value){
  return new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(Number(value||0))
}

// ─── XSS guard ────────────────────────────────────────────────────────────────
function escapeHtml(str){
  return String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}
const esc = escapeHtml

// ─── Data ──────────────────────────────────────────────────────────────────────
async function loadData(){
  try{
    const res = await fetch('data.json')
    const data = await res.json()
    return data.products || []
  }catch(e){
    console.warn('Could not load data.json',e)
    return []
  }
}

// ─── Session tracking (module-scope) ──────────────────────────────────────────
const USER_ID = (()=>{
  try{
    let id = localStorage.getItem('pheran_uid')
    if(!id){id='uid_'+Math.random().toString(36).slice(2);localStorage.setItem('pheran_uid',id)}
    return id
  }catch(e){return 'uid_anon'}
})()
const sessionBuffer = []
let sessionFlushTimer = null
function enqueueSessionEvents(events){
  sessionBuffer.push(...events)
  if(sessionFlushTimer) clearTimeout(sessionFlushTimer)
  sessionFlushTimer = setTimeout(()=>{ flushSessionBuffer() },2000)
}
async function flushSessionBuffer(){
  if(sessionFlushTimer){clearTimeout(sessionFlushTimer);sessionFlushTimer=null}
  if(!sessionBuffer.length) return
  const payloadEvents = sessionBuffer.splice(0,sessionBuffer.length)
  const payload = {userId:USER_ID,ts:Date.now(),events:payloadEvents}
  try{
    if('sendBeacon' in navigator){
      navigator.sendBeacon('/api/session',JSON.stringify(payload))
    }else{
      await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive:true})
    }
  }catch(e){}
}
function sendSessionEvent(items){
  try{
    const now = Date.now()
    const events = (items||[]).map(it=>typeof it==='string'?{id:it,type:'view',ts:now}:Object.assign({ts:now},it))
    enqueueSessionEvents(events)
  }catch(e){}
}
window.addEventListener('beforeunload',()=>{try{flushSessionBuffer()}catch(e){}})

// ─── Cart ──────────────────────────────────────────────────────────────────────
function getCart(){
  try{
    const raw=JSON.parse(localStorage.getItem('pheran_cart')||'[]')
    return Array.isArray(raw)?raw.filter(i=>i&&typeof i==='object'&&typeof i.key==='string'&&typeof i.title==='string'):[]
  }catch(e){return[]}
}
function saveCart(cart){
  localStorage.setItem('pheran_cart',JSON.stringify(cart))
  updateCartBadge()
  renderCartDrawer()
}
function cartAdd(product,size,color,qty){
  qty = Number(qty)||1
  const cart = getCart()
  const key = `${product.id}|${size}|${color}`
  const existing = cart.find(i=>i.key===key)
  if(existing){existing.qty += qty}
  else{cart.push({key,id:product.id,title:product.title,price:product.price,image:product.images[0],size,color,qty})}
  saveCart(cart)
}
function cartRemove(key){
  saveCart(getCart().filter(i=>i.key!==key))
}
function cartSetQty(key,qty){
  const cart = getCart()
  const item = cart.find(i=>i.key===key)
  if(item){
    if(qty<1){cartRemove(key);return}
    item.qty = qty
    saveCart(cart)
  }
}
function cartTotal(cart){
  return cart.reduce((s,i)=>s+i.price*i.qty,0)
}
function cartCount(cart){
  return cart.reduce((s,i)=>s+i.qty,0)
}
function updateCartBadge(){
  const count = cartCount(getCart())
  document.querySelectorAll('#cart-count-badge,.cart-count').forEach(el=>{
    el.textContent = count
    el.style.display = count>0?'inline-flex':'none'
  })
  document.querySelectorAll('#cart-drawer-count').forEach(el=>el.textContent=count)
}
function renderCartDrawer(){
  const body = document.getElementById('cart-drawer-body')
  const footer = document.getElementById('cart-drawer-footer')
  if(!body) return
  const cart = getCart()
  if(!cart.length){
    const bagIcon = typeof ICONS!=='undefined'?ICONS.bag:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 10.5V6a3.75 3.75 0 0 0-7.5 0v4.5M3.375 7.5h17.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125H3.375A1.125 1.125 0 0 1 2.25 19.875V8.625c0-.621.504-1.125 1.125-1.125Z"/></svg>'
    body.innerHTML = `<div class="cart-empty-msg"><div style="color:var(--purple-light);margin-bottom:12px">${bagIcon}</div><p>Your cart is empty</p><a href="category.html">Start shopping</a></div>`
    if(footer) footer.innerHTML=''
    return
  }
  body.innerHTML = cart.map(item=>`
    <div class="cart-item" data-key="${esc(item.key)}">
      <img src="${esc(item.image||'')}" alt="${esc(item.title)}" loading="lazy">
      <div class="cart-item-info">
        <div class="cart-item-title">${esc(item.title)}</div>
        <div class="cart-item-meta">${esc(item.color||'')} ${item.size?'· '+esc(item.size):''}</div>
        <div class="cart-item-controls">
          <button class="cart-qty-btn" data-action="dec" data-key="${esc(item.key)}">−</button>
          <span class="cart-item-qty">${item.qty}</span>
          <button class="cart-qty-btn" data-action="inc" data-key="${esc(item.key)}">+</button>
          <button class="cart-item-remove" data-key="${esc(item.key)}">Remove</button>
        </div>
      </div>
      <div class="cart-item-price">${formatCurrency(item.price*item.qty)}</div>
    </div>`).join('')
  body.querySelectorAll('.cart-qty-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const k=btn.dataset.key, item=getCart().find(i=>i.key===k)
      if(!item) return
      cartSetQty(k, item.qty + (btn.dataset.action==='inc'?1:-1))
    })
  })
  body.querySelectorAll('.cart-item-remove').forEach(btn=>{
    btn.addEventListener('click',()=>cartRemove(btn.dataset.key))
  })
  const total = cartTotal(cart)
  const shipping = total>=15000?0:1500
  if(footer) footer.innerHTML=`
    <div class="cart-summary-row"><span>Subtotal</span><span>${formatCurrency(total)}</span></div>
    <div class="cart-summary-row"><span>Shipping</span><span>${shipping===0?'<span style="color:var(--success)">Free</span>':formatCurrency(shipping)}</span></div>
    ${total<15000?`<div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">Add ${formatCurrency(15000-total)} more for free shipping</div>`:''}
    <div class="cart-summary-row total"><span>Total</span><span>${formatCurrency(total+shipping)}</span></div>
    <a class="cart-checkout-btn" href="checkout.html">Checkout</a>
    <a class="cart-view-full" href="cart.html">View full cart</a>
    <div class="cart-trust"><span>${typeof ICONS!=='undefined'?ICONS.shield:'🔒'} Secure</span><span>${typeof ICONS!=='undefined'?ICONS.refresh:'↩'} Returns</span><span>${typeof ICONS!=='undefined'?ICONS.truck:'🚚'} Delivery</span></div>`
}
function openCartDrawer(){
  document.getElementById('cart-overlay')?.classList.add('open')
  document.getElementById('cart-drawer')?.classList.add('open')
}
function closeCartDrawer(){
  document.getElementById('cart-overlay')?.classList.remove('open')
  document.getElementById('cart-drawer')?.classList.remove('open')
}
function initCartDrawer(){
  document.getElementById('cart-overlay')?.addEventListener('click',closeCartDrawer)
  document.getElementById('cart-drawer-close')?.addEventListener('click',closeCartDrawer)
  document.getElementById('cart-btn')?.addEventListener('click',openCartDrawer)
  document.getElementById('mobile-cart-btn')?.addEventListener('click',openCartDrawer)
  renderCartDrawer()
  updateCartBadge()
}

// ─── Wishlist ──────────────────────────────────────────────────────────────────
function getWishlist(){
  try{
    const raw=JSON.parse(localStorage.getItem('pheran_wishlist')||'[]')
    return Array.isArray(raw)?raw.filter(i=>typeof i==='string'):[]
  }catch(e){return[]}
}
function toggleWishlist(id){
  const list = getWishlist()
  const idx = list.indexOf(id)
  if(idx>=0) list.splice(idx,1)
  else list.push(id)
  localStorage.setItem('pheran_wishlist',JSON.stringify(list))
  return idx<0
}

// ─── Search overlay ────────────────────────────────────────────────────────────
function initSearch(products){
  const overlay = document.getElementById('search-overlay')
  const input = document.getElementById('search-input')
  const resultsEl = document.getElementById('search-results')
  const openBtn = document.getElementById('search-btn')
  const closeBtn = document.getElementById('search-close')
  if(!overlay) return
  function openSearch(){overlay.classList.add('open');setTimeout(()=>input?.focus(),80)}
  function closeSearch(){overlay.classList.remove('open');if(input) input.value='';if(resultsEl) resultsEl.innerHTML=''}
  openBtn?.addEventListener('click',openSearch)
  closeBtn?.addEventListener('click',closeSearch)
  overlay.addEventListener('click',e=>{if(e.target===overlay) closeSearch()})
  document.addEventListener('keydown',e=>{if(e.key==='Escape') closeSearch()})
  let searchTimer = null
  input?.addEventListener('input',()=>{
    clearTimeout(searchTimer)
    searchTimer = setTimeout(()=>{
      const q = (input.value||'').trim().toLowerCase()
      if(!q){resultsEl.innerHTML='';return}
      const hits = products.filter(p=>
        p.title.toLowerCase().includes(q)||
        p.category.toLowerCase().includes(q)||
        (p.fabric||'').toLowerCase().includes(q)||
        (p.description||'').toLowerCase().includes(q)
      ).slice(0,8)
      if(!hits.length){
        resultsEl.innerHTML='<div class="search-empty">No results found — try a different search.</div>'
        return
      }
      resultsEl.innerHTML = hits.map(p=>`
        <div class="search-result-item" data-id="${esc(p.id)}" tabindex="0">
          <img src="${esc(p.images[0]||'')}" alt="${esc(p.title)}" loading="lazy">
          <div class="search-result-meta">
            <strong>${esc(p.title)}</strong>
            <span>${esc(p.category)} · ${formatCurrency(p.price)}</span>
          </div>
        </div>`).join('') +
        `<a class="search-see-all" href="category.html">See all products →</a>`
      resultsEl.querySelectorAll('.search-result-item').forEach(el=>{
        const go=()=>{closeSearch();window.location.href='product.html?id='+el.dataset.id}
        el.addEventListener('click',go)
        el.addEventListener('keydown',e=>{if(e.key==='Enter') go()})
      })
    },200)
  })
}

// ─── PWA ───────────────────────────────────────────────────────────────────────
let deferredPrompt = null
function initPWA(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('../sw.js').catch(()=>{})
  }
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault()
    deferredPrompt = e
    const banner = document.getElementById('pwa-banner')
    if(banner && !localStorage.getItem('pwa_dismissed')){
      setTimeout(()=>banner.classList.add('show'),3000)
    }
  })
  document.getElementById('pwa-install-btn')?.addEventListener('click',async ()=>{
    if(!deferredPrompt) return
    deferredPrompt.prompt()
    const {outcome} = await deferredPrompt.userChoice
    if(outcome==='accepted') document.getElementById('pwa-banner')?.classList.remove('show')
    deferredPrompt = null
  })
  document.getElementById('pwa-dismiss')?.addEventListener('click',()=>{
    localStorage.setItem('pwa_dismissed','1')
    document.getElementById('pwa-banner')?.classList.remove('show')
  })
}

// ─── Bestsellers ───────────────────────────────────────────────────────────────
function renderBestsellers(products){
  const container = document.getElementById('bestsellers')
  if(!container) return
  container.innerHTML=''
  const wishlist = getWishlist()
  products.slice(0,8).forEach(p=>{
    const card = document.createElement('article')
    card.className='product-card'
    const saved = wishlist.includes(p.id)
    const heartFilled = typeof ICONS!=='undefined'?ICONS.heartFilled:'♥'
    const heartOutline = typeof ICONS!=='undefined'?ICONS.heartOutline:'♡'
    card.innerHTML=`
      <div style="position:relative;overflow:hidden">
        <img src="${esc(p.images[0])}" alt="${esc(p.title)}" loading="lazy">
        <button class="wishlist-btn${saved?' active':''}" data-id="${esc(p.id)}" aria-label="${saved?'Remove from':'Save to'} wishlist">${saved?heartFilled:heartOutline}</button>
      </div>
      <div class="card-body">
        <div class="card-title">${esc(p.title)}</div>
        <div class="card-price">${formatCurrency(p.price)}</div>
      </div>`
    card.querySelector('.wishlist-btn').addEventListener('click',e=>{
      e.stopPropagation()
      const btn = e.currentTarget
      const nowSaved = toggleWishlist(p.id)
      btn.innerHTML = nowSaved?heartFilled:heartOutline
      btn.classList.toggle('active',nowSaved)
    })
    card.addEventListener('click',()=>{sendSessionEvent([p.id]);window.location.href='product.html?id='+p.id})
    container.appendChild(card)
  })
}

// ─── Recently viewed ───────────────────────────────────────────────────────────
function getRecentlyViewed(){
  try{
    const raw=JSON.parse(localStorage.getItem('pheran_recently_viewed')||'[]')
    return Array.isArray(raw)?raw.filter(i=>typeof i==='string'):[]
  }catch(e){return[]}
}
function trackRecentlyViewed(id){
  const list = getRecentlyViewed().filter(item=>item!==id)
  list.unshift(id)
  localStorage.setItem('pheran_recently_viewed',JSON.stringify(list.slice(0,4)))
}

// ─── Mock reviews ──────────────────────────────────────────────────────────────
function generateReviews(product){
  const names = ['Adaeze O.','Fatima B.','Chisom E.','Ngozi A.','Blessing I.','Amara K.','Tolu M.','Sade F.']
  const cities = ['Lagos','Abuja','Port Harcourt','Ibadan','Kano','Enugu']
  const bodies = [
    'Absolutely stunning piece. The quality exceeded my expectations and the fit is perfect.',
    'I love this so much! The fabric feels luxurious and it arrived beautifully packaged.',
    'Great quality for the price. True to size and very flattering on my figure.',
    'This is my third purchase from PHERAN and they never disappoint. Highly recommended.',
    'The colour is even more beautiful in person. Fast delivery too!',
    'Perfect for the office and evening events. Very versatile piece.',
    'Great stitching and attention to detail. You can tell it\'s made with care.',
    'I received so many compliments wearing this. Worth every kobo.'
  ]
  const count = product.count || 20
  const rating = product.rating || 4.5
  const dist = {5:Math.round(count*0.62),4:Math.round(count*0.22),3:Math.round(count*0.1),2:Math.round(count*0.04),1:Math.round(count*0.02)}
  const reviews = Array.from({length:Math.min(6,count)},(_, i)=>{
    const starRating = i<3?5:i<5?4:3
    const d = new Date(2026,5-i,10-i*3)
    return{
      name:names[i%names.length],
      city:cities[i%cities.length],
      rating:starRating,
      date:d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}),
      body:bodies[i%bodies.length],
      helpful:Math.floor(Math.random()*18)+2
    }
  })
  return{rating,count,dist,reviews}
}

function renderReviews(product){
  const section = document.getElementById('reviews-section')
  if(!section) return
  const data = generateReviews(product)
  const bigRating = document.getElementById('big-rating')
  const starDisplay = document.getElementById('star-display')
  const reviewTotal = document.getElementById('review-total')
  const barsEl = document.getElementById('reviews-bars')
  const listEl = document.getElementById('reviews-list')
  const heading = document.getElementById('reviews-heading')
  if(bigRating) bigRating.textContent = data.rating.toFixed(1)
  if(starDisplay) starDisplay.textContent = '★'.repeat(Math.round(data.rating))+'☆'.repeat(5-Math.round(data.rating))
  if(reviewTotal) reviewTotal.textContent = `Based on ${data.count} reviews`
  if(heading) heading.textContent = `Customer Reviews (${data.count})`
  if(barsEl){
    barsEl.innerHTML = [5,4,3,2,1].map(star=>{
      const c = data.dist[star]||0
      const pct = data.count?Math.round(c/data.count*100):0
      return`<div class="bar-row">
        <span class="bar-label">${star}★</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="bar-count">${c}</span>
      </div>`}).join('')
  }
  if(listEl){
    listEl.innerHTML = data.reviews.map(r=>`
      <div class="review-card">
        <div class="review-header">
          <div>
            <div class="reviewer-name">${esc(r.name)}</div>
            <div class="reviewer-badge">✓ Verified purchase · ${esc(r.city)}</div>
          </div>
          <div>
            <div class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
            <div class="review-date">${esc(r.date)}</div>
          </div>
        </div>
        <p class="review-body">${esc(r.body)}</p>
        <div class="review-helpful">Helpful? <button onclick="this.textContent='Thanks! (${r.helpful})'">▲ ${r.helpful}</button></div>
      </div>`).join('')
  }
  document.getElementById('load-more-reviews')?.addEventListener('click',function(){
    this.textContent='All reviews shown'
    this.disabled=true
  })
}

// ─── Product Detail Page ───────────────────────────────────────────────────────
function renderProductDetail(products){
  const id = new URLSearchParams(window.location.search).get('id')
  const product = products.find(p=>p.id===id)||products[0]
  if(!product) return

  const colorMap = {
    'Soft Pink':'#F5E6EA','Lilac':'#C8A2C8','White':'#FFFFFF','Blue':'#7EB8FF',
    'Black':'#111111','Beige':'#D6C4A4','Olive':'#7C8B4B','Natural':'#EFE6D6',
    'Navy':'#163A5F','Deep Purple':'#4B0082'
  }

  const main = document.getElementById('main-photo')
  const title = document.getElementById('p-title')
  const price = document.getElementById('p-price')
  const old = document.getElementById('p-old')
  const rating = document.getElementById('p-rating')
  const reviewCount = document.getElementById('p-count')
  const desc = document.getElementById('p-desc')
  const categoryEl = document.getElementById('product-category')
  const colorSwatches = document.getElementById('color-swatches')
  const sizeSelect = document.getElementById('size-select')
  const qtyInput = document.getElementById('qty-input')
  const qtyIncrease = document.getElementById('qty-increase')
  const qtyDecrease = document.getElementById('qty-decrease')
  const addToCartBtn = document.getElementById('add-to-cart')
  const buyNowBtn = document.getElementById('buy-now')
  const wishlistBtn = document.getElementById('wishlist-toggle')
  const sizeGuideBtn = document.getElementById('size-guide-btn')
  const modal = document.getElementById('size-guide-modal')
  const closeSizeGuide = document.getElementById('close-size-guide')
  const thumbs = document.getElementById('thumbs')
  const spinBtn = document.getElementById('spin-button')
  const fabricPanel = document.getElementById('p-fabric')
  const recommendationGrid = document.getElementById('recommendation-grid')
  const accordionToggles = document.querySelectorAll('.accordion-toggle')
  const availabilityEl = document.getElementById('availability')
  const urgencyPill = document.getElementById('urgency-pill')
  const urgencyText = document.getElementById('urgency-text')
  const socialProofLine = document.getElementById('social-proof-line')
  const stickyBar = document.getElementById('sticky-bar')
  const stickyTitle = document.getElementById('sticky-title')
  const stickyPrice = document.getElementById('sticky-price')
  const stickyColor = document.getElementById('sticky-color')
  const stickySize = document.getElementById('sticky-size')
  const stickyAdd = document.getElementById('sticky-add')

  let selectedColor = product.colors?.[0]||''
  let selectedSize = product.sizes?.[0]||''

  // Populate fields
  document.title = product.title + ' — PHERAN'
  const ogTitle = document.querySelector('meta[property="og:title"]')
  if(ogTitle) ogTitle.setAttribute('content', product.title + ' — PHERAN')
  const ogDesc = document.querySelector('meta[property="og:description"]')
  if(ogDesc) ogDesc.setAttribute('content', product.description||'')
  if(title) title.textContent = product.title
  if(stickyTitle) stickyTitle.textContent = product.title
  if(price) price.textContent = formatCurrency(product.price)
  if(stickyPrice) stickyPrice.textContent = formatCurrency(product.price)
  if(old) old.textContent = product.oldPrice?formatCurrency(product.oldPrice):''
  if(rating) rating.textContent = product.rating?product.rating+' ★':''
  if(reviewCount) reviewCount.textContent = product.count?`(${product.count} reviews)`:''
  if(desc) desc.textContent = product.description||'Product information is coming soon.'
  if(categoryEl) categoryEl.textContent = product.category||''
  if(fabricPanel) fabricPanel.textContent = product.fabric?`${product.fabric}. Machine wash cold, hang to dry.`:'Premium fabric with easy care.'
  if(availabilityEl){
    availabilityEl.textContent = product.count>10?'In stock':product.count>0?'Low stock':'Out of stock'
    if(product.count>0&&product.count<=5){
      availabilityEl.textContent = `Only ${product.count} left`
      availabilityEl.style.background='#FFF5F0';availabilityEl.style.color='#C05621'
    }
  }
  // Urgency + social proof
  if(urgencyPill&&urgencyText&&product.count<=8&&product.count>0){
    urgencyText.textContent = `Only ${product.count} left — selling fast`
    urgencyPill.style.display='inline-flex'
  }
  if(socialProofLine){
    const viewers = Math.floor(Math.random()*12)+4
    socialProofLine.textContent = `${viewers} people are viewing this right now`
  }

  // Thumbnails + optional video thumb
  if(thumbs){
    thumbs.innerHTML=''
    product.images.forEach((img,index)=>{
      const t = document.createElement('img')
      t.src=img; t.alt=product.title+' view '+(index+1)
      t.addEventListener('click',()=>{switchToImage(img)})
      thumbs.appendChild(t)
    })
    // Video thumbnail (play button badge over first image)
    if(product.video){
      const vThumb = document.createElement('button')
      vThumb.type='button'
      vThumb.className='thumb-vid-btn'
      vThumb.setAttribute('aria-label','Watch product video')
      vThumb.style.cssText='position:relative;overflow:hidden;border:2px solid transparent;border-radius:6px;padding:0;cursor:pointer;background:#1c1917;flex-shrink:0;width:64px;height:72px'
      const vImg = document.createElement('img')
      vImg.src=product.images[0]; vImg.alt='Video preview'; vImg.style.cssText='width:100%;height:100%;object-fit:cover;opacity:0.7'
      const playBadge = document.createElement('span')
      playBadge.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:none'
      playBadge.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/></svg>'
      vThumb.appendChild(vImg); vThumb.appendChild(playBadge)
      vThumb.addEventListener('click',()=>switchToVideo(product.video))
      thumbs.appendChild(vThumb)
    }
    if(product.images[0]){switchToImage(product.images[0])}
  }
  function switchToImage(src){
    if(main){ main.src=src; main.style.display='block' }
    const vid = document.getElementById('product-vid')
    if(vid){ vid.style.display='none'; vid.pause(); vid.src='' }
    thumbs?.querySelectorAll('img').forEach(img=>img.classList.toggle('active',img.src.endsWith(src.split('/').pop())))
    thumbs?.querySelectorAll('.thumb-vid-btn').forEach(b=>b.style.borderColor='transparent')
  }
  function switchToVideo(src){
    let vid = document.getElementById('product-vid')
    if(!vid){
      vid=document.createElement('video')
      vid.id='product-vid'; vid.controls=true; vid.muted=true; vid.playsinline=true
      vid.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:10px;background:#000'
      main?.parentNode?.insertBefore(vid, main)
    }
    if(main) main.style.display='none'
    vid.src=src; vid.style.display='block'; vid.play()
    thumbs?.querySelectorAll('img').forEach(img=>img.classList.remove('active'))
    thumbs?.querySelectorAll('.thumb-vid-btn').forEach(b=>b.style.borderColor='var(--purple-main)')
  }
  function updateMainImage(src){switchToImage(src)}
  function setActiveThumb(selected){thumbs?.querySelectorAll('img').forEach(img=>img.classList.toggle('active',img.src.endsWith(selected.split('/').pop())))}

  // Color swatches
  if(colorSwatches){
    colorSwatches.innerHTML=''
    product.colors?.forEach(color=>{
      const swatch = document.createElement('button')
      swatch.type='button'; swatch.className='swatch'
      swatch.setAttribute('aria-label',color)
      const cv = colorMap[color]||'#E7E7E7'
      swatch.style.cssText = `width:28px;height:28px;border-radius:50%;background:${cv};border:2px solid ${color===selectedColor?'var(--purple-main)':'transparent'};cursor:pointer;margin:0 4px 4px 0`
      swatch.dataset.color=color
      if(color===selectedColor) swatch.style.borderColor='var(--purple-main)'
      swatch.addEventListener('click',()=>{
        selectedColor=color
        colorSwatches.querySelectorAll('button').forEach(b=>b.style.borderColor='transparent')
        swatch.style.borderColor='var(--purple-main)'
        if(stickyColor) stickyColor.value=color
        sendSessionEvent([{id:product.id,type:'color-select',value:color,ts:Date.now()}])
      })
      colorSwatches.appendChild(swatch)
    })
  }

  // Size selector
  if(sizeSelect){
    sizeSelect.innerHTML=''
    product.sizes?.forEach(size=>{
      const opt=document.createElement('option');opt.value=size;opt.textContent=size;sizeSelect.appendChild(opt)
    })
    sizeSelect.addEventListener('change',()=>{selectedSize=sizeSelect.value;if(stickySize) stickySize.value=selectedSize})
  }

  // Sticky bar selectors
  if(stickyColor){
    stickyColor.innerHTML=''
    product.colors?.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;stickyColor.appendChild(o)})
    stickyColor.addEventListener('change',()=>selectedColor=stickyColor.value)
  }
  if(stickySize){
    stickySize.innerHTML=''
    product.sizes?.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;stickySize.appendChild(o)})
    stickySize.addEventListener('change',()=>selectedSize=stickySize.value)
  }

  // Qty controls
  qtyIncrease?.addEventListener('click',()=>{qtyInput.value=Number(qtyInput.value||1)+1})
  qtyDecrease?.addEventListener('click',()=>{qtyInput.value=Math.max(1,Number(qtyInput.value||1)-1)})
  qtyInput?.addEventListener('input',()=>{if(Number(qtyInput.value)<1||isNaN(Number(qtyInput.value))) qtyInput.value=1})

  // Add to cart
  function doAddToCart(qty){
    cartAdd(product,selectedSize,selectedColor,qty)
    openCartDrawer()
    sendSessionEvent([{id:product.id,type:'add-to-cart',qty,ts:Date.now()}])
  }
  addToCartBtn?.addEventListener('click',()=>{
    const qty = Number(qtyInput?.value)||1
    doAddToCart(qty)
    addToCartBtn.textContent='Added ✓'
    setTimeout(()=>addToCartBtn.textContent='Add to Cart',1200)
  })
  stickyAdd?.addEventListener('click',()=>{
    doAddToCart(1)
    stickyAdd.textContent='Added ✓'
    setTimeout(()=>stickyAdd.textContent='Add to Cart',1200)
  })
  buyNowBtn?.addEventListener('click',()=>{
    doAddToCart(Number(qtyInput?.value)||1)
    sendSessionEvent([{id:product.id,type:'buy-now',ts:Date.now()}])
    window.location.href='checkout.html'
  })

  // Wishlist
  if(wishlistBtn){
    const saved = getWishlist().includes(product.id)
    wishlistBtn.textContent = saved?'♥':'♡'
    wishlistBtn.classList.toggle('saved',saved)
    wishlistBtn.addEventListener('click',()=>{
      const nowSaved = toggleWishlist(product.id)
      wishlistBtn.textContent = nowSaved?'♥':'♡'
      wishlistBtn.classList.toggle('saved',nowSaved)
    })
  }

  // Sticky bar show/hide on scroll
  const mainActions = document.getElementById('main-actions')
  if(stickyBar&&mainActions){
    const observer = new IntersectionObserver(entries=>{
      stickyBar.classList.toggle('visible',!entries[0].isIntersecting)
    },{threshold:0.1})
    observer.observe(mainActions)
  }

  // Size guide modal
  sizeGuideBtn?.addEventListener('click',()=>{modal?.classList.add('open');modal?.setAttribute('aria-hidden','false')})
  closeSizeGuide?.addEventListener('click',()=>{modal?.classList.remove('open');modal?.setAttribute('aria-hidden','true')})
  modal?.querySelector('.modal-close')?.addEventListener('click',()=>{modal.classList.remove('open');modal.setAttribute('aria-hidden','true')})
  modal?.addEventListener('click',e=>{if(e.target===modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true')}})

  // Accordions
  accordionToggles.forEach(toggle=>{
    const targetId=toggle.dataset.target; const panel=document.getElementById(targetId)
    if(!panel) return
    toggle.addEventListener('click',()=>{
      const open=panel.classList.contains('open')
      document.querySelectorAll('.accordion-toggle').forEach(b=>b.classList.remove('active'))
      document.querySelectorAll('.accordion-panel').forEach(p=>p.classList.remove('open'))
      if(!open){panel.classList.add('open');toggle.classList.add('active')}
    })
  })

  // 360° spin
  if(spinBtn){
    let spinInterval=null
    spinBtn.addEventListener('click',()=>{
      if(spinInterval) return
      const frames=product.images.length>1?product.images.slice():[product.images[0]]
      let index=0
      spinBtn.textContent='Spinning…'
      spinInterval=setInterval(()=>{
        index=(index+1)%frames.length
        updateMainImage(frames[index])
      },280)
      setTimeout(()=>{clearInterval(spinInterval);spinInterval=null;updateMainImage(product.images[0]);spinBtn.textContent='360° view'},2100)
    })
  }

  // Recommendations
  if(recommendationGrid){
    recommendationGrid.innerHTML=''
    const related=products.filter(p=>p.category===product.category&&p.id!==product.id).slice(0,3)
    const fallback=products.filter(p=>p.id!==product.id).sort((a,b)=>(b.rating||0)-(a.rating||0)).slice(0,3)
    const picks=related.length?related:fallback
    picks.forEach(p=>{
      const card=document.createElement('article');card.className='recommendation-card'
      card.innerHTML=`
        <img src="${esc(p.images[0])}" alt="${esc(p.title)}" loading="lazy">
        <h3>${esc(p.title)}</h3>
        <div class="price">${formatCurrency(p.price)}</div>`
      card.addEventListener('click',()=>{
        sendSessionEvent([{id:p.id,type:'recommendation-click',ts:Date.now()}])
        window.location.href='product.html?id='+p.id
      })
      recommendationGrid.appendChild(card)
    })
  }

  trackRecentlyViewed(product.id)
  sendSessionEvent([{id:product.id,type:'view',ts:Date.now()}])
  renderReviews(product)
}

// ─── Category page ─────────────────────────────────────────────────────────────
function renderCategory(products){
  const grid = document.getElementById('product-grid')
  const sizesEl = document.getElementById('filter-sizes')
  const colorsEl = document.getElementById('filter-colors')
  const fabricsEl = document.getElementById('filter-fabrics')
  const priceMin = document.getElementById('price-min')
  const priceMax = document.getElementById('price-max')
  const applyBtn = document.getElementById('apply-filters')
  const clearBtn = document.getElementById('clear-filters')
  const paginationEl = document.getElementById('pagination')
  const loadMoreBtn = document.getElementById('load-more')
  const mobileCount = document.getElementById('mobile-result-count')
  const mobileSortSelect = document.getElementById('sort-select-mobile')
  const categoryTitle = document.getElementById('category-title')
  const categoryBadge = document.getElementById('category-badge')
  const categoryButtons = document.querySelectorAll('.category-actions button')
  const presetButtons = document.querySelectorAll('.preset-buttons button')
  const savedPresetsWrap = document.getElementById('saved-presets')
  const savePresetButton = document.getElementById('save-preset')
  const openFiltersBtn = document.getElementById('open-filters')
  const recentlyViewedWrap = document.getElementById('recently-viewed')
  let currentPage = 1
  const perPage = 12
  let currentCategory = ''
  const spinner = document.getElementById('loading-spinner')
  const sortSelect = document.getElementById('sort-select')
  let currentSort = sortSelect?sortSelect.value:(mobileSortSelect?mobileSortSelect.value:'popular')
  const cacheTTL = 60*1000
  const respCache = new Map()

  if(sortSelect) sortSelect.addEventListener('change',()=>{currentSort=sortSelect.value;if(mobileSortSelect) mobileSortSelect.value=currentSort;currentPage=1;applyFilters()})
  if(mobileSortSelect) mobileSortSelect.addEventListener('change',()=>{currentSort=mobileSortSelect.value;if(sortSelect) sortSelect.value=currentSort;currentPage=1;applyFilters()})
  if(openFiltersBtn) openFiltersBtn.addEventListener('click',()=>document.querySelector('.filters')?.classList.toggle('open'))

  function setLoadingState(loading){
    const fw=document.querySelector('.filters'),pw=document.querySelector('.products')
    if(loading){
      fw?.classList.add('disabled-ui');pw?.classList.add('disabled-ui')
      if(sortSelect) sortSelect.disabled=true
      if(applyBtn) applyBtn.disabled=true
      if(clearBtn) clearBtn.disabled=true
    }else{
      fw?.classList.remove('disabled-ui');pw?.classList.remove('disabled-ui')
      if(sortSelect) sortSelect.disabled=false
      if(applyBtn) applyBtn.disabled=false
      if(clearBtn) clearBtn.disabled=false
    }
  }

  function updateActivePills(state){
    const container=document.getElementById('active-pills')
    if(!container) return
    container.innerHTML=''
    Object.keys(state).forEach(key=>{
      if(!state[key]||(Array.isArray(state[key])&&!state[key].length)) return
      const vals = Array.isArray(state[key])?state[key]:[state[key]]
      vals.forEach(v=>{
        const pill=document.createElement('span');pill.className='pill'
        pill.innerHTML=`${esc(key)}: ${esc(v)} <button class="remove" aria-label="Remove ${esc(v)}">✕</button>`
        pill.querySelector('.remove').addEventListener('click',()=>{
          if(key==='category') setCurrentCategory('')
          else if(key==='price'){priceMin.value='';priceMax.value=''}
          else document.querySelectorAll(`.filter-chip[data-value="${v}"]`).forEach(el=>el.classList.remove('active'))
          applyFilters()
        })
        container.appendChild(pill)
      })
    })
  }

  function setCurrentCategory(category){
    currentCategory=category||''
    if(categoryTitle) categoryTitle.textContent=category?`${category} Collection`:'All Products'
    if(categoryBadge) categoryBadge.textContent=category?`${category} edit`:'All edit'
    categoryButtons.forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.category===category)
    })
    currentPage=1
  }

  function getSavedPresets(){
    try{
      const raw=JSON.parse(localStorage.getItem('pheran_saved_presets')||'[]')
      return Array.isArray(raw)?raw.filter(i=>i&&typeof i==='object'&&typeof i.name==='string'):[]
    }catch(e){return[]}
  }
  function renderSavedPresets(){
    if(!savedPresetsWrap) return
    const list=getSavedPresets()
    savedPresetsWrap.innerHTML=''
    if(!list.length){savedPresetsWrap.textContent='No saved presets yet';return}
    list.forEach((preset,index)=>{
      const btn=document.createElement('button');btn.className='btn tertiary preset-item';btn.textContent=preset.name||`Preset ${index+1}`
      btn.addEventListener('click',()=>applyPreset(preset))
      const del=document.createElement('button');del.className='preset-delete';del.textContent='✕'
      del.addEventListener('click',e=>{e.stopPropagation();const next=list.filter((_,i)=>i!==index);localStorage.setItem('pheran_saved_presets',JSON.stringify(next));renderSavedPresets()})
      const wrapper=document.createElement('div');wrapper.className='preset-row'
      wrapper.appendChild(btn);wrapper.appendChild(del);savedPresetsWrap.appendChild(wrapper)
    })
  }

  function applyPreset(preset){
    if(!preset) return
    setCurrentCategory(preset.category||'')
    if(preset.min!==undefined) priceMin.value=preset.min
    if(preset.max!==undefined) priceMax.value=preset.max
    if(preset.sort) currentSort=preset.sort
    if(sortSelect) sortSelect.value=currentSort
    document.querySelectorAll('.filter-chip').forEach(ch=>ch.classList.remove('active'))
    if(Array.isArray(preset.size)) preset.size.forEach(v=>{document.querySelector(`.filter-chip.size[data-value="${v}"]`)?.classList.add('active')})
    if(Array.isArray(preset.color)) preset.color.forEach(v=>{document.querySelector(`.filter-chip.color[data-value="${v}"]`)?.classList.add('active')})
    if(Array.isArray(preset.fabric)) preset.fabric.forEach(v=>{document.querySelector(`.filter-chip.fabric[data-value="${v}"]`)?.classList.add('active')})
    currentPage=1;applyFilters()
  }

  const sectionPresets = {
    new_arrivals:{name:'New arrivals',sort:'rating_desc',min:0,max:250},
    editor_pick:{name:"Editor's pick",sort:'popular',size:['M'],fabric:['Linen']}
  }

  function saveCurrentPreset(){
    const name=prompt('Name this preset');if(!name) return
    const preset={
      name,category:currentCategory,
      min:priceMin.value||'',max:priceMax.value||'',sort:currentSort,
      size:[...document.querySelectorAll('.filter-chip.size.active')].map(n=>n.dataset.value),
      color:[...document.querySelectorAll('.filter-chip.color.active')].map(n=>n.dataset.value),
      fabric:[...document.querySelectorAll('.filter-chip.fabric.active')].map(n=>n.dataset.value)
    }
    const list=getSavedPresets();list.unshift(preset)
    localStorage.setItem('pheran_saved_presets',JSON.stringify(list.slice(0,5)))
    renderSavedPresets()
  }

  function createFilterChip(category,value){
    const chip=document.createElement('button');chip.type='button';chip.className=`filter-chip ${category}`
    chip.dataset.value=value;chip.setAttribute('aria-pressed','false')
    chip.innerHTML=`<span>${esc(value)}</span>`;return chip
  }

  function populateFilterPanels(prods){
    const sizes=new Set(),colors=new Set(),fabrics=new Set()
    prods.forEach(p=>{(p.sizes||[]).forEach(s=>sizes.add(s));(p.colors||[]).forEach(c=>colors.add(c));if(p.fabric) fabrics.add(p.fabric)})
    if(sizesEl){sizesEl.innerHTML='';Array.from(sizes).sort().forEach(v=>sizesEl.appendChild(createFilterChip('size',v)))}
    if(colorsEl){colorsEl.innerHTML='';Array.from(colors).sort().forEach(v=>colorsEl.appendChild(createFilterChip('color',v)))}
    if(fabricsEl){fabricsEl.innerHTML='';Array.from(fabrics).sort().forEach(v=>fabricsEl.appendChild(createFilterChip('fabric',v)))}
  }

  function renderRecentlyViewed(){
    if(!recentlyViewedWrap) return
    const recent=getRecentlyViewed()
    if(!recent.length){recentlyViewedWrap.innerHTML='<h3>Recently viewed</h3><p class="text-muted">Your recent style previews will appear here.</p>';return}
    const cards=recent.map(id=>{
      const p=products.find(x=>x.id===id);if(!p) return''
      return`<button type="button" class="recent-item" data-id="${esc(p.id)}"><img src="${esc(p.images[0])}" alt="${esc(p.title)}" loading="lazy"><div class="meta"><strong>${esc(p.title)}</strong><div>${formatCurrency(p.price)}</div></div></button>`
    }).join('')
    recentlyViewedWrap.innerHTML=`<h3>Recently viewed</h3><div class="recent-list">${cards}</div>`
    recentlyViewedWrap.querySelectorAll('.recent-item').forEach(btn=>btn.addEventListener('click',()=>window.location.href='product.html?id='+btn.dataset.id))
  }

  function renderGrid(list){
    grid.innerHTML=''
    if(!list.length){
      grid.innerHTML=`<div class="empty-full">
        <div class="ef-icon">🔍</div>
        <h3>No styles match your filters</h3>
        <p>Try adjusting your filters or browsing our full collection below.</p>
        <div class="ef-actions">
          <button class="btn primary" id="clear-empty-btn">Clear all filters</button>
          <a class="btn secondary" href="category.html">Browse all</a>
        </div>
      </div>`
      document.getElementById('clear-empty-btn')?.addEventListener('click',()=>{
        document.querySelectorAll('.filter-chip').forEach(n=>n.classList.remove('active'))
        priceMin.value='';priceMax.value='';currentPage=1;applyFilters()
      })
      return
    }
    const wishlist = getWishlist()
    list.forEach(p=>{
      const card=document.createElement('article');card.className='product-card'
      const saved = wishlist.includes(p.id)
      card.innerHTML=`
        <img src="${esc(p.images[0])}" alt="${esc(p.title)}" loading="lazy">
        <h3>${esc(p.title)}</h3>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
          <div class="price">${formatCurrency(p.price)}</div>
          <span style="font-size:0.82rem;color:var(--gold)">${p.rating?p.rating+'★':''}</span>
        </div>
        <div class="card-actions">
          <button type="button" class="quick-add">Quick Add</button>
          <button type="button" class="wishlist-btn${saved?' saved':''}" data-id="${esc(p.id)}" aria-label="Save to wishlist">${saved?'♥':'♡'}</button>
        </div>`
      card.querySelector('.quick-add').addEventListener('click',e=>{
        e.stopPropagation()
        cartAdd(p,p.sizes?.[0]||'',p.colors?.[0]||'',1)
        const btn=e.currentTarget;btn.textContent='Added ✓';setTimeout(()=>btn.textContent='Quick Add',900)
        sendSessionEvent([{id:p.id,type:'quick-add',ts:Date.now()}])
      })
      card.querySelector('.wishlist-btn').addEventListener('click',e=>{
        e.stopPropagation()
        const btn=e.currentTarget
        const nowSaved=toggleWishlist(p.id)
        btn.textContent=nowSaved?'♥':'♡';btn.classList.toggle('saved',nowSaved)
      })
      card.addEventListener('click',()=>{trackRecentlyViewed(p.id);sendSessionEvent([p.id]);window.location.href='product.html?id='+p.id})
      grid.appendChild(card)
    })
  }

  function renderPagination(total,page){
    if(!paginationEl) return
    paginationEl.innerHTML=''
    const totalPages=Math.max(1,Math.ceil(total/perPage))
    const prev=document.createElement('button');prev.textContent='Prev';prev.disabled=page<=1
    prev.addEventListener('click',()=>{if(prev.disabled) return;currentPage=Math.max(1,page-1);applyFilters()})
    paginationEl.appendChild(prev)
    const maxShown=7;let start=Math.max(1,page-Math.floor(maxShown/2));let end=Math.min(totalPages,start+maxShown-1)
    if(end-start<maxShown-1) start=Math.max(1,end-maxShown+1)
    for(let i=start;i<=end;i++){
      const b=document.createElement('button');b.className='page-num';b.textContent=i
      if(i===page) b.classList.add('active')
      b.addEventListener('click',()=>{currentPage=i;applyFilters()})
      paginationEl.appendChild(b)
    }
    const next=document.createElement('button');next.textContent='Next';next.disabled=page>=totalPages
    next.addEventListener('click',()=>{if(next.disabled) return;currentPage=Math.min(totalPages,page+1);applyFilters()})
    paginationEl.appendChild(next)
  }

  function updateLoadMore(total,page){
    const totalPages=Math.max(1,Math.ceil(total/perPage))
    if(loadMoreBtn){loadMoreBtn.style.display=page<totalPages?'inline-flex':'none'}
  }

  function computeFacetCounts(){
    const min=Number(priceMin?.value||0),max=Number(priceMax?.value||Infinity)
    const selSizes=[...document.querySelectorAll('.filter-chip.size.active')].map(n=>n.dataset.value)
    const selColors=[...document.querySelectorAll('.filter-chip.color.active')].map(n=>n.dataset.value)
    const selFabrics=[...document.querySelectorAll('.filter-chip.fabric.active')].map(n=>n.dataset.value)
    function count(excludedKey,option,category){
      let list=products.filter(p=>p.price>=min&&p.price<=max)
      if(currentCategory) list=list.filter(p=>p.category===currentCategory)
      if(category!=='size'&&selSizes.length) list=list.filter(p=>(p.sizes||[]).some(s=>selSizes.includes(s)))
      if(category!=='color'&&selColors.length) list=list.filter(p=>(p.colors||[]).some(c=>selColors.includes(c)))
      if(category!=='fabric'&&selFabrics.length) list=list.filter(p=>selFabrics.includes(p.fabric))
      if(category==='size') return list.filter(p=>(p.sizes||[]).includes(option)).length
      if(category==='color') return list.filter(p=>(p.colors||[]).includes(option)).length
      if(category==='fabric') return list.filter(p=>p.fabric===option).length
      return 0
    }
    ;['size','color','fabric'].forEach(cat=>{
      document.querySelectorAll(`.filter-chip.${cat}`).forEach(ch=>{
        const v=ch.dataset.value,c=count(cat,v,cat)
        let span=ch.querySelector('.chip-count')
        if(!span){span=document.createElement('span');span.className='chip-count small';ch.appendChild(span)}
        span.textContent=`(${c})`
        if(c===0) ch.classList.add('disabled');else ch.classList.remove('disabled')
      })
    })
  }

  async function fetchServerProducts(params){
    try{
      setLoadingState(true)
      if(spinner) spinner.setAttribute('aria-hidden','false')
      const qs=new URLSearchParams(params).toString()
      const now=Date.now();const cached=respCache.get(qs)
      if(cached&&(now-cached.ts)<cacheTTL) return cached.data
      const res=await fetch('/api/products?'+qs)
      if(!res.ok) return null
      const json=await res.json()
      respCache.set(qs,{ts:now,data:json});return json
    }catch(e){return null}finally{
      if(spinner) spinner.setAttribute('aria-hidden','true')
      setLoadingState(false)
    }
  }

  function buildParams(selSizes,selColors,selFabrics,min,max,page){
    const params={}
    if(currentCategory) params.category=currentCategory
    if(selSizes.length) params.size=selSizes.join(',')
    if(selColors.length) params.color=selColors.join(',')
    if(selFabrics.length) params.fabric=selFabrics.join(',')
    if(min>0) params.min=min
    if(max!==Infinity) params.max=max
    params.page=page;params.perPage=perPage
    if(currentSort) params.sort=currentSort
    return params
  }

  function syncUrl(params){
    const query=new URLSearchParams(params)
    history.replaceState({},'',query.toString()?`?${query.toString()}`:window.location.pathname)
  }

  async function applyFilters(){
    const min=Number(priceMin?.value||0),max=Number(priceMax?.value||Infinity)
    const selSizes=[...document.querySelectorAll('.filter-chip.size.active')].map(n=>n.dataset.value)
    const selColors=[...document.querySelectorAll('.filter-chip.color.active')].map(n=>n.dataset.value)
    const selFabrics=[...document.querySelectorAll('.filter-chip.fabric.active')].map(n=>n.dataset.value)
    currentSort=sortSelect?sortSelect.value:currentSort
    const state={size:selSizes,color:selColors,fabric:selFabrics}
    if(currentCategory) state.category=currentCategory
    if(priceMin?.value||priceMax?.value) state.price=`${priceMin.value||0}–${priceMax.value||''}`
    const params=buildParams(selSizes,selColors,selFabrics,min,max,currentPage)
    const serverResp=await fetchServerProducts(params)
    if(serverResp&&serverResp.products){
      const srv=serverResp
      updateActivePills(state);renderGrid(srv.products)
      const total=srv.total,pageNumber=srv.page||currentPage
      document.getElementById('results-count').textContent=`Showing ${total} result${total!==1?'s':''}`
      if(mobileCount) mobileCount.textContent=`Showing ${total} result${total!==1?'s':''}`
      renderPagination(total,pageNumber);updateLoadMore(total,pageNumber);syncUrl(params)
    }else{
      computeFacetCounts();updateActivePills(state)
      let filtered=products.filter(p=>p.price>=min&&p.price<=max)
      if(currentCategory) filtered=filtered.filter(p=>p.category===currentCategory)
      if(selSizes.length) filtered=filtered.filter(p=>p.sizes?.some(s=>selSizes.includes(s)))
      if(selColors.length) filtered=filtered.filter(p=>p.colors?.some(c=>selColors.includes(c)))
      if(selFabrics.length) filtered=filtered.filter(p=>selFabrics.includes(p.fabric))
      if(currentSort==='price_asc') filtered.sort((a,b)=>a.price-b.price)
      else if(currentSort==='price_desc') filtered.sort((a,b)=>b.price-a.price)
      else if(currentSort==='rating_desc') filtered.sort((a,b)=>(b.rating||0)-(a.rating||0))
      const total=filtered.length,start=(currentPage-1)*perPage
      const paged=filtered.slice(start,start+perPage)
      renderGrid(paged)
      document.getElementById('results-count').textContent=`Showing ${total} result${total!==1?'s':''}`
      if(mobileCount) mobileCount.textContent=`Showing ${total} result${total!==1?'s':''}`
      renderPagination(total,currentPage);updateLoadMore(total,currentPage);syncUrl(params)
    }
  }

  const debounce=(fn,wait)=>{let t;return function(...args){clearTimeout(t);t=setTimeout(()=>fn.apply(this,args),wait)}}
  const debouncedApply=debounce(()=>applyFilters(),250)

  // Init
  const urlCategory=new URLSearchParams(window.location.search).get('category')||''
  setCurrentCategory(urlCategory)
  populateFilterPanels(products)
  renderSavedPresets()
  renderRecentlyViewed()
  const params=new URLSearchParams(window.location.search)
  if(params.get('min')) priceMin.value=params.get('min')
  if(params.get('max')) priceMax.value=params.get('max')
  categoryButtons.forEach(btn=>btn.addEventListener('click',()=>{setCurrentCategory(btn.dataset.category);applyFilters()}))
  presetButtons.forEach(btn=>btn.addEventListener('click',()=>{const p=sectionPresets[btn.dataset.preset];if(p) applyPreset(p)}))
  savePresetButton?.addEventListener('click',saveCurrentPreset)
  document.querySelectorAll('.filter-chip').forEach(ch=>ch.addEventListener('click',e=>{
    const el=e.currentTarget;el.classList.toggle('active');el.setAttribute('aria-pressed',el.classList.contains('active'));currentPage=1;debouncedApply()
  }))
  applyBtn?.addEventListener('click',applyFilters)
  clearBtn?.addEventListener('click',()=>{
    document.querySelectorAll('.filter-chip').forEach(n=>n.classList.remove('active'))
    priceMin.value='';priceMax.value='';currentPage=1;applyFilters()
  })
  loadMoreBtn?.addEventListener('click',()=>{currentPage+=1;applyFilters()})
  priceMin?.addEventListener('input',debouncedApply)
  priceMax?.addEventListener('input',debouncedApply)
  // Infinite scroll on mobile
  let scrollTimer=null
  window.addEventListener('scroll',()=>{
    if(!loadMoreBtn||loadMoreBtn.style.display==='none') return
    if(scrollTimer) clearTimeout(scrollTimer)
    scrollTimer=setTimeout(()=>{
      if(window.scrollY>=document.body.scrollHeight-window.innerHeight-240){currentPage+=1;applyFilters()}
    },150)
  })
  applyFilters()
}

// ─── Header scroll effect ──────────────────────────────────────────────────────
function initHeaderScroll(){
  const header = document.querySelector('.site-header')
  if(!header) return
  const onScroll = ()=>header.classList.toggle('scrolled', window.scrollY > 12)
  window.addEventListener('scroll', onScroll, {passive:true})
  onScroll()
}

// ─── Stagger grid animation ────────────────────────────────────────────────────
function initStaggerGrids(){
  document.querySelectorAll('.collections-grid,.testimonial-grid,.editorial-grid,.values-grid,.support-cards-grid').forEach(el=>{
    el.classList.add('stagger-grid')
  })
}

// ─── DOMContentLoaded ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',async ()=>{
  const products = await loadData()
  initCartDrawer()
  initSearch(products)
  initPWA()
  initHeaderScroll()
  initStaggerGrids()
  renderBestsellers(products)
  if(document.body.classList.contains('product-page')){
    renderProductDetail(products)
  }
  if(document.body.classList.contains('category-page')){
    renderCategory(products)
  }
})
