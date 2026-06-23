// ===== shared site behaviour: nav, mobile menu, scroll reveal, carousels =====

function initReveal() {
  const revealEls = document.querySelectorAll('.reveal:not(.observed)');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(el => { el.classList.add('observed'); io.observe(el); });
  } else {
    revealEls.forEach(el => { el.classList.add('observed'); el.classList.add('in-view'); });
  }
}

function initCarousels() {
  document.querySelectorAll('[data-carousel]:not(.initialized)').forEach(carousel => {
    carousel.classList.add('initialized');
    const slides = carousel.querySelector('.slides');
    const imgs = slides.querySelectorAll('img');
    const nav = carousel.querySelector('.carousel-nav');
    const prevBtn = carousel.querySelector('[data-prev]');
    const nextBtn = carousel.querySelector('[data-next]');
    let current = 0;
    const total = imgs.length;

    imgs.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => goTo(i));
      nav.appendChild(dot);
    });

    function goTo(index) {
      current = (index + total) % total;
      slides.style.transform = 'translateX(-' + (current * 100) + '%)';
      nav.querySelectorAll('.carousel-dot').forEach((d, i) =>
        d.classList.toggle('active', i === current)
      );
    }

    prevBtn.addEventListener('click', () => goTo(current - 1));
    nextBtn.addEventListener('click', () => goTo(current + 1));

    let touchStartX = 0;
    carousel.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    carousel.addEventListener('touchend', e => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) goTo(current + (diff > 0 ? 1 : -1));
    }, { passive: true });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.getElementById('nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 30);
    window.addEventListener('scroll', onScroll);
    onScroll();
  }

  const burgerBtn = document.getElementById('burgerBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileClose = document.getElementById('mobileClose');
  if (burgerBtn && mobileMenu) {
    burgerBtn.addEventListener('click', () => mobileMenu.classList.add('open'));
    mobileClose.addEventListener('click', () => mobileMenu.classList.remove('open'));
    mobileMenu.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => mobileMenu.classList.remove('open'))
    );
  }

  initReveal();
  initCarousels();
});
