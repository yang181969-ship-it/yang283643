function initNotesPage() {
  const notesPage = document.querySelector(".notes-page");
  if (!notesPage) return;

  const groupToggles = notesPage.querySelectorAll(".notes-group-toggle");
  const categoryButtons = notesPage.querySelectorAll(".notes-category");
  const noteCards = notesPage.querySelectorAll(".note-card");
  const emptyState = notesPage.querySelector("#notes-empty");

  if (!noteCards.length) return;

  function renderMathInNotes() {
    if (!window.renderMathInElement) return;

    requestAnimationFrame(() => {
      renderMathInElement(notesPage, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ],
        throwOnError: false
      });
    });
  }

  function clearActiveStates() {
    groupToggles.forEach((btn) => btn.classList.remove("active"));
    categoryButtons.forEach((btn) => btn.classList.remove("active"));
  }

  function filterAllNotes() {
    noteCards.forEach((card) => {
      card.classList.remove("is-hidden");
    });

    if (emptyState) {
      emptyState.hidden = true;
    }

    renderMathInNotes();
  }

  function filterNotesByCategory(category) {
    let visibleCount = 0;

    noteCards.forEach((card) => {
      const cardCategory = card.dataset.category;

      if (cardCategory === category) {
        card.classList.remove("is-hidden");
        visibleCount += 1;
      } else {
        card.classList.add("is-hidden");
      }
    });

    if (emptyState) {
      emptyState.hidden = visibleCount !== 0;
    }

    renderMathInNotes();
  }

  groupToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const parentGroup = toggle.closest(".notes-group");
      const mode = toggle.dataset.mode;
      const groupName = toggle.dataset.group;

      if (mode === "all") {
        clearActiveStates();
        toggle.classList.add("active");

        notesPage.querySelectorAll(".notes-group").forEach((group) => {
          if (group.querySelector('[data-mode="all"]')) {
            group.classList.add("is-open");
          } else {
            group.classList.remove("is-open");
          }
        });

        filterAllNotes();
        return;
      }

      if (groupName) {
        const isOpen = parentGroup.classList.contains("is-open");

        notesPage.querySelectorAll(".notes-group").forEach((group) => {
          if (group !== parentGroup && !group.querySelector('[data-mode="all"]')) {
            group.classList.remove("is-open");
          }
        });

        parentGroup.classList.toggle("is-open", !isOpen);
      }
    });
  });

  categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      clearActiveStates();
      button.classList.add("active");

      const parentGroup = button.closest(".notes-group");
      if (parentGroup) {
        notesPage.querySelectorAll(".notes-group").forEach((group) => {
          if (group !== parentGroup && !group.querySelector('[data-mode="all"]')) {
            group.classList.remove("is-open");
          }
        });
        parentGroup.classList.add("is-open");
      }

      filterNotesByCategory(button.dataset.category);
    });
  });

  const defaultOverview = notesPage.querySelector('.notes-group-toggle[data-mode="all"]');
  if (defaultOverview) {
    clearActiveStates();
    defaultOverview.classList.add("active");
    filterAllNotes();
  } else {
    renderMathInNotes();
  }
}

document.addEventListener("DOMContentLoaded", initNotesPage);
window.initNotesPage = initNotesPage;