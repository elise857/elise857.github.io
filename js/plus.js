/* Espace équipe DAM Essentiel — module « plus »
   Deux ajouts, écrits à part du programme principal pour rester lisibles et modifiables :

   1. CARNET D'ADRESSES (côté gérant) — l'espace retient de lui-même à qui part quoi.
      · Un devis part à la personne inscrite « À l'attention de » sur le devis.
      · Une facture part au service facturation du client, avec le demandeur en copie.
      · Chaque envoi réussi enrichit le carnet (table « contacts » dans Supabase) : plus rien à retaper.

   2. CARTE DES CHANTIERS (gérant ET géomètres) — la carte 3D du chantier avec, autour,
      les hébergements (Airbnb, gîtes, chambres d'hôtes, hôtels), les restaurants et les boulangeries.
      Données OpenStreetMap (gratuit, sans compte), gardées 30 jours dans la table « geo_lieux ».

   Le module est appelé par app.js via window.DAM_PLUS. S'il n'est pas chargé, l'espace fonctionne comme avant. */
(function () {
  "use strict";
  const P = {};
  window.DAM_PLUS = P;

  /* ---------- liaison avec le programme principal ---------- */
  let t = null, K = null, L = null, V = null, render = null, eur = null, today = null, norm = null, bn = null, dfr = null;
  let demarre = false;
  P.lier = (api) => {
    t = api.t; K = api.K; L = api.L; V = api.V; render = api.render;
    eur = api.eur; today = api.today; norm = api.norm; bn = api.bn; dfr = api.jourFr;
    if (!demarre) { demarre = true; styles(); observer(); if (V()) chargerContacts(); }
  };
  const el = (n, a, ...k) => t(n, a, ...k);
  const parle = (m) => { try { console.info("[DAM+] " + m); } catch (_) {} };

  /* ===========================================================
     1. CARNET D'ADRESSES
     =========================================================== */
  let contacts = [], contactsCharges = false;
  const FACTURE_MOTIF = /(factur|compta|fournisseur|invoice|accounting)/i;

  const chargerContacts = async () => {
    try {
      const r = await K.from("contacts").select("*").eq("actif", true);
      if (r.error) throw r.error;
      contacts = r.data || []; contactsCharges = true;
      parle(contacts.length + " contacts dans le carnet");
      // le carnet arrive après le premier affichage : on redessine pour montrer les bonnes adresses
      try { redessiner(); } catch (_) {}
    } catch (e) { parle("carnet indisponible : " + (e.message || e)); }
  };
  P.rechargerCarnet = chargerContacts;

  const ent = (id) => ((bn && bn.ent) || []).find((x) => x.id === id) || null;
  const dossier = (id) => ((bn && bn.dos) || []).find((x) => x.id === id) || null;
  const piece = (id) => ((bn && bn.pieces) || []).find((x) => x.id === id) || null;
  const deEnt = (eid) => contacts.filter((c) => c.entreprise_id === eid);
  const nomDeMail = (m) => String(m || "").split("@")[0].replace(/[._-]+/g, " ").replace(/\d+/g, "").trim()
    .replace(/(^|\s)([a-zà-ÿ])/g, (x) => x.toUpperCase());
  const libelle = (c) => c.nom || nomDeMail(c.email);
  const estFacturation = (c) => c.role === "facturation" || FACTURE_MOTIF.test(String(c.email).split("@")[0]);

  // le nom tapé sur le devis (« À l'attention de ») correspond-il à ce contact ?
  const memeNom = (c, nomTape) => {
    const n = norm(nomTape || ""); if (n.length < 3) return false;
    const cibles = [c.nom, nomDeMail(c.email)].filter(Boolean).map(norm);
    if (cibles.some((x) => x === n)) return true;
    const mots = String(nomTape).split(/[\s.,;-]+/).map(norm).filter((x) => x.length > 2);
    return cibles.some((x) => x.includes(n) || (n.length > 4 && x.length > 4 && n.includes(x)))
      || (mots.length > 1 && cibles.some((x) => mots.every((m) => x.includes(m))));
  };

  // dernière adresse utilisée pour ce dossier (filet de sécurité d'origine)
  const dernierEnvoi = (dossierId, filtre) => {
    const E = ((bn && bn.envois) || []).filter((e) => e.dossier_id === dossierId && e.destinataires && e.statut !== "echec" && (!filtre || filtre(e)))
      .sort((a, b) => String(b.le || "").localeCompare(String(a.le || "")));
    return E.length ? E[0].destinataires : "";
  };

  /* Qui doit recevoir ce document ? Renvoie { to, cc, pourquoi, … } */
  const choisir = (n) => {
    const d = dossier(n.dossierId), pc = n.pieceId ? piece(n.pieceId) : null;
    const e = d ? ent(d.entreprise_id) : null;
    const type = pc ? pc.type : "";
    const nature = n.nature || "envoi";
    const facture = type === "facture" || type === "avoir";
    const C = e ? deEnt(e.id) : [];
    const nomTape = (pc && pc.contact) || "";
    const parNom = C.filter((c) => memeNom(c, nomTape)).sort((a, b) => (b.nb_envois || 0) - (a.nb_envois || 0))[0] || null;
    const demandeurs = C.filter((c) => !estFacturation(c)).sort((a, b) => ((b.nb_devis || 0) - (a.nb_devis || 0)) || ((b.nb_envois || 0) - (a.nb_envois || 0)));
    const factu = C.filter(estFacturation).sort((a, b) => ((b.nb_factures || 0) - (a.nb_factures || 0)) || ((b.nb_envois || 0) - (a.nb_envois || 0)));
    const mail = (c) => (c ? c.email : "");
    let to = "", cc = "", pourquoi = "";

    if (facture) {
      const cible = factu[0] || null;
      const dem = parNom || demandeurs[0] || null;
      if (cible) {
        to = mail(cible);
        pourquoi = "Service facturation de " + (e ? e.nom : "ce client") + (cible.nb_factures ? " (déjà " + cible.nb_factures + " facture" + (cible.nb_factures > 1 ? "s" : "") + ")" : "");
        if (dem && dem.email !== to) { cc = mail(dem); pourquoi += ", " + libelle(dem) + " en copie"; }
      } else if (dem) {
        to = mail(dem);
        pourquoi = "Aucun service facturation connu chez " + (e ? e.nom : "ce client") + " : adresse du demandeur. Elle sera retenue comme adresse de facturation après l'envoi.";
      }
    } else {
      const cible = parNom || demandeurs[0] || factu[0] || null;
      if (cible) {
        to = mail(cible);
        pourquoi = parNom
          ? "Adresse de " + libelle(parNom) + ", la personne inscrite « À l'attention de » sur " + (type === "devis" ? "le devis" : "la pièce")
          : "Dernier interlocuteur chez " + (e ? e.nom : "ce client") + ((cible.nb_devis || 0) ? " (" + cible.nb_devis + " devis)" : "");
      }
      // un rapport intéresse aussi celui qui a reçu le précédent : on le garde en copie
      if (nature === "rapport") {
        const r = dernierEnvoi(n.dossierId, (x) => x.nature === "rapport");
        if (r && r !== to) { cc = r; pourquoi += (pourquoi ? ", " : "") + "destinataire du dernier rapport en copie"; }
      }
    }
    if (!to) {
      to = (e && e.contact_email) || dernierEnvoi(n.dossierId) || "";
      if (to) pourquoi = "Adresse de la fiche client ou du dernier envoi — elle sera enregistrée dans le carnet.";
    }
    return { to, cc, pourquoi, entreprise: e, contacts: C, nomTape, facture };
  };

  /* appelé par app.js juste avant d'ouvrir la fenêtre d'envoi */
  P.avantEnvoi = (n) => {
    try {
      if (!V()) return;
      const r = choisir(n);
      if (r.to) { n.to = r.to; n.cc = r.cc || ""; }
      n._plus = r;
    } catch (e) { parle("avantEnvoi : " + (e.message || e)); }
  };

  /* adresse par défaut d'un dossier (utilisée aussi pour les relances groupées) */
  P.adresseDossier = (d) => {
    try { if (!V() || !d) return ""; return choisir({ dossierId: d.id, nature: "relance" }).to || ""; }
    catch (e) { return ""; }
  };

  /* carnet affiché sous le champ destinataire, avec un clic pour choisir */
  P.apresDialogue = (dlg, n) => {
    try {
      if (!V() || !n || !n._plus) return;
      const r = n._plus, champTo = dlg.querySelector("#ev-to"), champCc = dlg.querySelector("#ev-cc");
      if (!champTo) return;
      const bloc = el("div", { class: "dp-carnet" });
      if (r.pourquoi) bloc.append(el("p", { class: "dp-pourquoi", text: r.pourquoi }));
      const C = r.contacts.slice().sort((a, b) => (b.nb_envois || 0) - (a.nb_envois || 0));
      if (C.length) {
        const ligne = el("div", { class: "dp-puces" }, el("span", { class: "dp-t", text: "Carnet " + (r.entreprise ? r.entreprise.nom : "") + " :" }));
        C.forEach((c) => {
          const ajouter = (champ) => {
            if (!champ) return;
            const v = champ.value.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
            if (!v.includes(c.email)) v.push(c.email);
            champ.value = v.join(", ");
          };
          ligne.append(el("span", { class: "dp-puce" + (estFacturation(c) ? " factu" : "") },
            el("button", { type: "button", title: c.email + " — mettre en destinataire", onclick: () => { champTo.value = c.email; } },
              libelle(c) + (estFacturation(c) ? " · facturation" : "")),
            el("button", { type: "button", class: "dp-cc", title: "Mettre en copie", onclick: () => ajouter(champCc) }, "+Cc")));
        });
        bloc.append(ligne);
      }
      bloc.append(el("p", { class: "dp-note", text: "Toute adresse nouvelle est ajoutée au carnet du client après l'envoi." }));
      const champ = champTo.closest(".field") || champTo.parentElement;
      champ.after(bloc);
    } catch (e) { parle("apresDialogue : " + (e.message || e)); }
  };

  /* après un envoi réussi : le carnet apprend */
  P.apprendre = async (n, to, cc) => {
    if (!V()) return;
    const d = dossier(n.dossierId); if (!d || !d.entreprise_id) return;
    const pc = n.pieceId ? piece(n.pieceId) : null;
    const type = pc ? pc.type : "";
    const facture = type === "facture" || type === "avoir";
    const nomTape = (pc && pc.contact) || "";
    const maintenant = new Date().toISOString();
    const lot = [];
    const traiter = (adr, principal) => {
      const email = String(adr || "").trim().toLowerCase();
      if (!email || email.indexOf("@") < 1) return;
      if (/@damessentiel\.|dam\.essentiel@/.test(email)) return; // nos propres adresses
      const exist = contacts.find((c) => c.entreprise_id === d.entreprise_id && c.email === email);
      const role = facture ? (principal ? "facturation" : "demandeur")
        : FACTURE_MOTIF.test(email.split("@")[0]) ? "facturation" : "demandeur";
      if (exist) {
        const maj = {
          nb_envois: (exist.nb_envois || 0) + 1,
          nb_devis: (exist.nb_devis || 0) + (type === "devis" && principal ? 1 : 0),
          nb_factures: (exist.nb_factures || 0) + (facture && principal ? 1 : 0),
          nb_rapports: (exist.nb_rapports || 0) + (n.nature === "rapport" && principal ? 1 : 0),
          dernier_le: maintenant,
        };
        if (facture && principal && exist.role !== "facturation") maj.role = "facturation";
        if (!exist.nom && principal && nomTape && !facture) maj.nom = nomTape;
        Object.assign(exist, maj);
        lot.push(K.from("contacts").update(maj).eq("id", exist.id));
      } else {
        const neuf = {
          entreprise_id: d.entreprise_id, email, role, source: "appris",
          nom: principal && !facture ? nomTape : "",
          nb_envois: 1,
          nb_devis: type === "devis" && principal ? 1 : 0,
          nb_factures: facture && principal ? 1 : 0,
          nb_rapports: n.nature === "rapport" && principal ? 1 : 0,
          dernier_le: maintenant,
        };
        contacts.push(neuf);
        lot.push(K.from("contacts").insert(neuf));
      }
    };
    (to || []).forEach((a) => traiter(a, true));
    (cc || []).forEach((a) => traiter(a, false));
    try { await Promise.all(lot); } catch (e) { parle("apprendre : " + (e.message || e)); }
    chargerContacts();
  };

  /* ---------- liste déroulante sur « À l'attention de » et sur les champs e-mail ---------- */
  const DATA_NOMS = "dp-liste-noms", DATA_MAILS = "dp-liste-mails";
  const listeDatalist = (id, valeurs) => {
    let dl = document.getElementById(id);
    if (!dl) { dl = document.createElement("datalist"); dl.id = id; document.body.append(dl); }
    dl.replaceChildren(...valeurs.map((v) => { const o = document.createElement("option"); o.value = v.v; if (v.l) o.label = v.l; return o; }));
    return dl;
  };
  // Entreprise de la pièce en cours d'édition : on la déduit du client affiché en haut du formulaire.
  const entrepriseDuFormulaire = () => {
    const hints = Array.from(document.querySelectorAll("#main .hint")).map((x) => x.textContent || "");
    const h = hints.find((x) => /^Client\s*:/.test(x));
    if (!h) return null;
    const nom = norm(h.replace(/^Client\s*:\s*/, "").split("·")[0].split(",")[0]);
    return ((bn && bn.ent) || []).find((e) => norm(e.nom) === nom) || null;
  };
  const enrichirChamps = () => {
    if (!V() || !contactsCharges) return;
    document.querySelectorAll("#main input:not([data-dp])").forEach((inp) => {
      // On marque TOUT champ examiné, pas seulement celui qui nous intéresse :
      // sans cela, l'espace réexaminait tous les champs de la page à chaque rafraîchissement,
      // ce qui ralentissait l'ensemble de l'application.
      inp.dataset.dp = "1";
      const champ = inp.closest(".field"); if (!champ) return;
      const lab = (champ.querySelector("label, .lab, span") || {}).textContent || champ.textContent || "";
      if (!/attention de/i.test(lab)) return;
      const e = entrepriseDuFormulaire(); if (!e) return;
      const C = deEnt(e.id).filter((c) => !estFacturation(c));
      if (!C.length) return;
      listeDatalist(DATA_NOMS, C.map((c) => ({ v: libelle(c), l: c.email })));
      inp.setAttribute("list", DATA_NOMS);
      inp.setAttribute("autocomplete", "off");
      if (!champ.querySelector(".dp-aide")) champ.append(el("small", { class: "dp-aide", text: "Les personnes déjà connues chez " + e.nom + " sont proposées : le devis partira à l'adresse de celle que vous choisissez." }));
    });
  };

  /* ===========================================================
     2. CARTE DES CHANTIERS ET ALENTOURS
     =========================================================== */
  const SIEGE = { lat: 44.9586, lon: -0.1733, nom: "Saint-Denis-de-Pile" };

  /* Point de départ du déplacement. Par défaut le siège, mais chacun peut partir d'ailleurs
     (domicile, chantier précédent). Le choix est gardé dans geo_lieux sous la clé « depart:<personne> »
     et suit donc la personne d'un appareil à l'autre. */
  const cleDepart = () => "depart:" + ((L && L.userId) || "defaut");
  const depart = () => {
    const d = geo[cleDepart()];
    return d && d.lat != null ? { lat: +d.lat, lon: +d.lon, nom: d.label || "point choisi" } : SIEGE;
  };
  P.changerDepart = async (texte) => {
    const t = String(texte || "").trim();
    if (!t) return;
    if (norm(t) === norm(SIEGE.nom) || norm(t) === "siege") { // retour au siège : on efface le choix
      const c = cleDepart();
      delete geo[c];
      try { await K.from("geo_lieux").delete().eq("cle", c); } catch (e) { parle("retour au siège : " + (e.message || e)); }
      redessiner(); return;
    }
    const v = await chercherMeilleurLieu([t]);
    if (!v) { alert("Lieu introuvable : « " + t + " ». Essayez la commune avec son code postal."); return; }
    await enregistrerGeo(cleDepart(), { lat: v.lat, lon: v.lon, label: v.label, source: v.source, manuel: true });
    redessiner();
  };
  const ZONES = [
    { max: 50, lib: "0 à 50 km", ligne: "Déplacement 0-50 km — inclus" },
    { max: 150, lib: "50 à 150 km", ligne: "Déplacement 50-150 km" },
    { max: 300, lib: "150 à 300 km", ligne: "Déplacement 150-300 km" },
    { max: 500, lib: "300 à 500 km", ligne: "Déplacement 300-500 km" },
    { max: 1e9, lib: "plus de 500 km", ligne: "Déplacement plus de 500 km" },
  ];
  const R_TERRE = 6371;
  const dist = (a, b) => {
    const r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
    const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
    return 2 * R_TERRE * Math.asin(Math.sqrt(h)); // km
  };
  const fmtD = (m) => (m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km");
  const trajet = (m) => (m <= 1200 ? Math.max(1, Math.round(m / 80)) + " min à pied" : Math.max(2, Math.round((m * 1.3) / 500)) + " min en voiture");
  const jours = (a, b) => {
    const d1 = new Date(a + "T00:00:00"), d2 = new Date(b + "T00:00:00");
    return Math.max(0, Math.round((d2 - d1) / 864e5));
  };
  const deuxCh = (n) => String(n).padStart(2, "0");
  const enIso = (x) => x.getFullYear() + "-" + deuxCh(x.getMonth() + 1) + "-" + deuxCh(x.getDate());
  const veille = (d) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() - 1); return enIso(x); };

  /* ---------- les chantiers (sessions) visibles par l'utilisateur ---------- */
  const mesChantiers = () => {
    const auj = today();
    const S = (L.missions || []).filter((s) => {
      if (!V() && !L.owner) {
        const e = s.equipe || [];
        if (!(L.moiId && e.includes(L.moiId))) return false;
      }
      return (s.fin || s.debut || "") >= auj;
    });
    return S.sort((a, b) => String(a.debut || "").localeCompare(String(b.debut || "")));
  };
  const intitule = (s) => [s.client, s.ouvrage].filter(Boolean).join(" · ") || s.num_session || "Chantier";
  /* Les noms d'ouvrage citent souvent DEUX communes (« Breuil-Marmagne », « ARUDY-BIZANOS-ST CRICQ »).
     On ne peut pas se contenter du premier bout : « Breuil » tout seul tombe sur un hameau de la Somme.
     On renvoie donc tous les bouts, et la localisation gardera le meilleur. */
  const candidatsLieu = (s) => {
    if (s.lieu && s.lieu.trim()) return [s.lieu.trim()];
    const o = String(s.ouvrage || "").replace(/\b\d+\s*k?v\b/gi, " ").replace(/\b(ligne|poste|liaison|piquage|antenne)\b/gi, " ");
    return o.split(/[-–—/,;]+/).map((x) => x.trim()).filter((x) => x.length > 3 && !/^\d+$/.test(x)).slice(0, 3);
  };

  /* ---------- localisation (Photon puis Nominatim), gardée dans geo_lieux ---------- */
  const geo = {};          // cle -> {lat,lon,label} | null (introuvable)
  let geoCharge = false;
  const chargerGeo = async () => {
    try {
      const r = await K.from("geo_lieux").select("*");
      if (r.error) throw r.error;
      (r.data || []).forEach((x) => { geo[x.cle] = x; });
      geoCharge = true;
    } catch (e) { parle("geo_lieux indisponible : " + (e.message || e)); geoCharge = true; }
  };
  const enregistrerGeo = async (cle, v) => {
    geo[cle] = Object.assign({ cle }, v);
    try { await K.from("geo_lieux").upsert(Object.assign({ cle }, v), { onConflict: "cle" }); }
    catch (e) { parle("écriture geo_lieux : " + (e.message || e)); }
  };
  /* Une vraie commune vaut toujours mieux qu'un hameau, un lieu-dit ou un ruisseau :
     c'est ce qui faisait tomber « Breuil-Marmagne » sur un hameau de la Somme. */
  const COMMUNE = ["city", "town", "village", "municipality"];
  const rang = (p) => (p.osm_key === "place" && COMMUNE.includes(p.osm_value) ? 2
    : p.osm_key === "place" && p.osm_value === "hamlet" ? 1 : 0);

  const chercherAdresse = async (q) => {
    const texte = q + (/(france|^\d{5})/i.test(q) ? "" : ", France");
    try {
      const r = await fetch("https://photon.komoot.io/api/?lang=fr&limit=8&lat=46.6&lon=2.3&q=" + encodeURIComponent(texte));
      if (r.ok) {
        const j = await r.json();
        const F = (j.features || []).filter((f) => f && f.geometry);
        // on prend la meilleure : commune d'abord, hameau ensuite, le reste en dernier
        const f = F.slice().sort((a, b) => rang(b.properties || {}) - rang(a.properties || {}))[0];
        if (f) {
          const p = f.properties || {}, [lon, lat] = f.geometry.coordinates;
          return { lat, lon, label: [p.name, p.postcode, p.city, p.state].filter(Boolean).join(" "), source: "photon", rang: rang(p) };
        }
      }
    } catch (_) {}
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=fr&q=" + encodeURIComponent(texte));
      if (r.ok) {
        const j = await r.json();
        const C = (j || []).filter((x) => /city|town|village|administrative|municipality/.test(String(x.type) + " " + String(x.class)));
        const x = C[0] || (j || [])[0];
        if (x) return { lat: +x.lat, lon: +x.lon, label: x.display_name, source: "nominatim", rang: C[0] ? 2 : 0 };
      }
    } catch (_) {}
    return null;
  };

  /* Essaie chaque commune citée et garde la plus crédible (une vraie commune l'emporte). */
  const chercherMeilleurLieu = async (candidats) => {
    let secours = null;
    for (const q of candidats) {
      const v = await chercherAdresse(q);
      if (!v) continue;
      if ((v.rang || 0) >= 2) return v;        // vraie commune : on s'arrête là
      if (!secours || (v.rang || 0) > (secours.rang || 0)) secours = v;
    }
    return secours;
  };
  const enCoursGeo = {};
  const localiser = (s) => {
    const cle = "session:" + s.id;
    if (geo[cle]) return geo[cle];
    if (enCoursGeo[cle]) return null;
    const Q = candidatsLieu(s); if (!Q.length) return null;
    enCoursGeo[cle] = chercherMeilleurLieu(Q).then(async (v) => {
      if (v) { await enregistrerGeo(cle, v); redessiner(); }
      else geo[cle] = null;
      delete enCoursGeo[cle];
    }).catch(() => { delete enCoursGeo[cle]; });
    return null;
  };
  P.corrigerLieu = async (s, texte) => {
    const v = await chercherAdresse(texte);
    if (!v) { alert("Lieu introuvable : « " + texte + " ». Essayez le nom de la commune avec son code postal."); return; }
    v.manuel = true;
    await enregistrerGeo("session:" + s.id, v);
    delete alentoursMem["session:" + s.id];
    redessiner();
  };

  /* ---------- hébergements, restaurants, boulangeries (OpenStreetMap) ---------- */
  const alentoursMem = {};
  const gammeHeb = (t) => {
    const st = parseFloat(String(t.stars || "").replace(",", "."));
    if (t.tourism === "hostel") return { g: 1, lib: "Auberge" };
    if (t.tourism === "chalet") return { g: 1.8, lib: "Gîte / chalet" };
    if (t.tourism === "guest_house") return { g: 2, lib: "Chambre d'hôtes ou gîte" };
    if (t.tourism === "apartment") return { g: 2.1, lib: "Meublé / appartement" };
    if (t.tourism === "motel") return { g: 1.4, lib: "Motel" };
    if (/premi[eè]re classe|ibis budget|b&b h[oô]tel|hotel f1|formule 1|campanile|kyriad|fasthotel|brit|balladins/i.test(t.name || "")) return { g: 1.5, lib: "Hôtel économique" };
    if (st) return { g: st <= 1 ? 1.6 : st <= 2 ? 2 : st <= 3 ? 3 : st <= 4 ? 4 : 5, lib: "Hôtel " + "★".repeat(Math.round(Math.min(5, st))) };
    if (/novotel|mercure|holiday inn|best western|appart|adagio|citadines/i.test(t.name || "")) return { g: 3, lib: "Hôtel milieu de gamme" };
    if (/sofitel|hilton|pullman|marriott|radisson|hyatt|palace|ch[aâ]teau/i.test(t.name || "")) return { g: 4.5, lib: "Hôtel haut de gamme" };
    return { g: 2.8, lib: "Hôtel" };
  };
  const gammeResto = (t) => {
    const c = (t.cuisine || "").toLowerCase(), n = (t.name || "").toLowerCase();
    if (t.amenity === "fast_food" || /kebab|burger|sandwich|tacos|friterie|snack/.test(c + " " + n)) return { g: 1, lib: "€", type: "Restauration rapide" };
    if (/routier|ouvrier/.test(c + " " + n)) return { g: 1.8, lib: "€€", type: "Routier" };
    if (/pizza|crepe|crêpe|asian|chinese|vietnamese|thai|japanese|sushi|indian|turkish|lebanese|italian|pasta/.test(c)) {
      const m = { pizza: "Pizzeria", crepe: "Crêperie", japanese: "Japonais", sushi: "Sushi", chinese: "Chinois", vietnamese: "Vietnamien", thai: "Thaï", indian: "Indien", italian: "Italien", lebanese: "Libanais", turkish: "Turc", asian: "Asiatique" };
      return { g: 2, lib: "€€", type: m[c.split(";")[0]] || "Restaurant" };
    }
    if (/fine_dining|gastronom/.test(c + " " + n)) return { g: 4, lib: "€€€€", type: "Gastronomique" };
    if (/brasserie|bistro|bouchon|regional|french|traditional|buffet/.test(c + " " + n)) return { g: 2.5, lib: "€€", type: /brasserie/.test(c + n) ? "Brasserie" : "Cuisine traditionnelle" };
    return { g: 3, lib: "€€€", type: "Restaurant" };
  };
  const adresse = (t) => [[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const uniq = (arr) => {
    const vu = new Set();
    return arr.filter((x) => { const k = norm(x.nom) + "|" + Math.round(x.lat * 1000) + "|" + Math.round(x.lon * 1000); if (vu.has(k)) return false; vu.add(k); return true; });
  };
  const equilibre = (arr, parGamme, max) => {
    const par = {};
    arr.forEach((x) => { (par[x.g] = par[x.g] || []).push(x); });
    return Object.values(par).flatMap((g) => g.slice(0, parGamme)).sort((a, b) => a.g - b.g || a.d - b.d).slice(0, max);
  };
  /* Première réponse, en 2 à 3 secondes : moteur Photon (OpenStreetMap / komoot).
     Noms, types et adresses seulement — les étoiles, horaires et téléphones arrivent ensuite par Overpass. */
  const chercherRapide = async (pt) => {
    const { lat, lon } = pt, o = { lat, lon };
    const H = ["tourism:hotel", "tourism:guest_house", "tourism:apartment", "tourism:chalet", "tourism:motel", "tourism:hostel"];
    const RS = ["amenity:restaurant", "amenity:fast_food"];
    const repos = (ms) => new Promise((r) => setTimeout(r, ms));
    /* Le service public de komoot limite le débit : en rafale, une partie des appels revient vide
       et la recherche semblait « échouer ». On demande donc un sujet après l'autre,
       avec une courte pause, et on réessaie une fois en cas de refus. */
    const demande = async (q, tags) => {
      const u = "https://photon.komoot.io/api/?lang=fr&limit=40&location_bias_scale=0&zoom=16&lat=" + lat + "&lon=" + lon
        + "&q=" + encodeURIComponent(q) + tags.map((x) => "&osm_tag=" + x).join("");
      for (let essai = 0; essai < 2; essai++) {
        try {
          const r = await fetch(u);
          if (r.ok) { const j = await r.json(); return j.features || []; }
        } catch (_) {}
        await repos(700);                      // trop vite : on laisse respirer puis on retente
      }
      return [];
    };
    const SUJETS = [["hotel", H], ["gite", H], ["chambre d'hotes", H], ["restaurant", RS],
      ["pizza", RS], ["brasserie", RS], ["boulangerie", ["shop:bakery", "shop:pastry"]]];
    const lots = [];
    for (const [q, tags] of SUJETS) { lots.push(await demande(q, tags)); await repos(200); }
    const vers = (f) => {
      const p = f.properties || {}, c = f.geometry.coordinates;
      const t = {
        name: p.name,
        tourism: p.osm_key === "tourism" ? p.osm_value : "",
        amenity: p.osm_key === "amenity" ? p.osm_value : "",
        shop: p.osm_key === "shop" ? p.osm_value : "",
        "addr:housenumber": p.housenumber, "addr:street": p.street, "addr:postcode": p.postcode, "addr:city": p.city,
      };
      return { t, lat: c[1], lon: c[0], d: Math.round(dist(o, { lat: c[1], lon: c[0] }) * 1000) };
    };
    const tout = lots.flat().map(vers).filter((x) => x.t.name);
    const simple = (x, extra) => Object.assign({
      nom: x.t.name, lat: +x.lat.toFixed(6), lon: +x.lon.toFixed(6), d: x.d,
      adresse: adresse(x.t), ville: x.t["addr:city"] || "", tel: "", site: "", horaires: "",
    }, extra);
    const heb = uniq(tout.filter((x) => x.t.tourism && x.d <= 12000).map((x) => { const g = gammeHeb(x.t); return simple(x, { g: g.g, gamme: g.lib, type: x.t.tourism }); })).sort((a, b) => a.d - b.d);
    const res = uniq(tout.filter((x) => x.t.amenity && x.d <= 6000).map((x) => { const g = gammeResto(x.t); return simple(x, { g: g.g, gamme: g.lib, type: g.type }); })).sort((a, b) => a.d - b.d);
    const boul = uniq(tout.filter((x) => x.t.shop && x.d <= 6000).map((x) => simple(x, { g: 1 }))).sort((a, b) => a.d - b.d).slice(0, 10);
    if (!heb.length && !res.length && !boul.length) throw new Error("aucun résultat");
    return { v: 1, le: today(), complet: false, heb: equilibre(heb, 6, 26), res: equilibre(res, 6, 26), boul };
  };

  /* Deuxième passage, plus lent : Overpass, qui ajoute étoiles, horaires, téléphones et sites. */
  /* Recherche détaillée, par Nominatim (le service de recherche d'OpenStreetMap).
     Les serveurs Overpass, utilisés auparavant, refusent les appels venant d'un site web
     (règle CORS du navigateur) : mesuré le 17/11/2026 depuis dam-equipe.netlify.app,
     aucun d'eux n'était joignable, ni en direct ni par relais. Nominatim, lui, répond
     en moins d'une seconde et donne aussi les téléphones, horaires et sites. */
  const chercherComplet = async (pt) => {
    const { lat, lon } = pt, o = { lat, lon };
    // Nominatim cherche dans un rectangle : on le calcule autour du chantier.
    const cadre = (km) => {
      const dl = km / 111, dn = km / (111 * Math.cos(lat * Math.PI / 180));
      return [(lon - dn).toFixed(5), (lat + dl).toFixed(5), (lon + dn).toFixed(5), (lat - dl).toFixed(5)].join(",");
    };
    const repos = (ms) => new Promise((r) => setTimeout(r, ms));
    const demande = async (q, km) => {
      const u = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&bounded=1&addressdetails=1&extratags=1"
        + "&viewbox=" + cadre(km) + "&q=" + encodeURIComponent(q);
      for (let essai = 0; essai < 2; essai++) {
        try { const r = await fetch(u); if (r.ok) { const j = await r.json(); return Array.isArray(j) ? j : []; } } catch (_) {}
        await repos(1200);
      }
      return [];
    };
    // Nominatim accepte au plus une demande par seconde : on les enchaîne posément.
    const SUJETS = [["hotel", 12], ["gite", 12], ["chambre d'hotes", 12], ["restaurant", 6], ["boulangerie", 6]];
    const lots = [];
    for (const [q, km] of SUJETS) { lots.push(await demande(q, km)); await repos(1100); }
    if (!lots.some((x) => x.length)) throw new Error("aucun résultat");
    {
      // on remet les réponses dans la même forme que les étiquettes OpenStreetMap
      const vers = (x) => {
        const a = x.address || {}, e = x.extratags || {};
        const t = {
          name: x.name || "",
          tourism: x.category === "tourism" ? x.type : "",
          amenity: x.category === "amenity" ? x.type : "",
          shop: x.category === "shop" ? x.type : "",
          cuisine: e.cuisine || "", stars: e.stars || "",
          phone: e.phone || e["contact:phone"] || "",
          website: e.website || e["contact:website"] || "",
          opening_hours: e.opening_hours || "",
          "addr:housenumber": a.house_number, "addr:street": a.road,
          "addr:postcode": a.postcode, "addr:city": a.village || a.town || a.city || a.municipality || "",
        };
        return { t, lat: +x.lat, lon: +x.lon };
      };
      const brut = lots.flat().map(vers)
        .filter((x) => x.t.name && isFinite(x.lat) && isFinite(x.lon))
        .map((x) => Object.assign(x, { d: Math.round(dist(o, x) * 1000) }));
      const simple = (x, extra) => Object.assign({
        nom: x.t.name || "Boulangerie", lat: +x.lat.toFixed(6), lon: +x.lon.toFixed(6), d: x.d,
        adresse: adresse(x.t), ville: x.t["addr:city"] || "", tel: x.t.phone || x.t["contact:phone"] || "",
        site: x.t.website || x.t["contact:website"] || "", horaires: x.t.opening_hours || "",
      }, extra);
      // le rectangle déborde du cercle : on écarte ce qui est trop loin, et les catégories hors sujet
      const HEB = /^(hotel|motel|guest_house|hostel|apartment|chalet)$/, RES = /^(restaurant|fast_food)$/, BOUL = /^(bakery|pastry)$/;
      const heb = uniq(brut.filter((x) => HEB.test(x.t.tourism) && x.d <= 12000).map((x) => { const g = gammeHeb(x.t); return simple(x, { g: g.g, gamme: g.lib, type: x.t.tourism }); })).sort((a, b) => a.d - b.d);
      const res = uniq(brut.filter((x) => RES.test(x.t.amenity) && x.d <= 6000).map((x) => { const g = gammeResto(x.t); return simple(x, { g: g.g, gamme: g.lib, type: g.type }); })).sort((a, b) => a.d - b.d);
      const boul = uniq(brut.filter((x) => BOUL.test(x.t.shop) && x.d <= 6000).map((x) => simple(x, { g: 1 }))).sort((a, b) => a.d - b.d).slice(0, 10);
      return { v: 1, le: today(), complet: true, heb: equilibre(heb, 6, 26), res: equilibre(res, 6, 26), boul };
    }
  };

  const garder = async (cle, r) => {
    if (geo[cle]) { geo[cle].alentours = r; geo[cle].alentours_le = r.le; }
    try { await K.from("geo_lieux").update({ alentours: r, alentours_le: r.le }).eq("cle", cle); } catch (_) {}
  };
  const complets = {};
  const lancerComplet = (cle, pt) => {
    if (complets[cle]) return;
    complets[cle] = chercherComplet(pt).then((r) => garder(cle, r)).then(redessiner)
      .catch((e) => parle("Overpass indisponible : " + (e.message || e)))
      .then(() => { delete complets[cle]; });
  };
  /* Renvoie les alentours s'ils sont prêts, « erreur » si les deux moteurs ont échoué, sinon null (recherche en cours). */
  const alentours = (cle, pt) => {
    const g = geo[cle];
    if (g && g.alentours && g.alentours_le && jours(g.alentours_le, today()) <= 30) {
      if (!g.alentours.complet && !complets[cle]) lancerComplet(cle, pt); // on complète en tâche de fond
      return g.alentours;
    }
    if (alentoursMem[cle] === "erreur") return "erreur";
    if (!alentoursMem[cle]) {
      alentoursMem[cle] = chercherRapide(pt).then((r) => garder(cle, r)).then(redessiner)
        .catch((e) => {
          parle("recherche rapide : " + (e.message || e));
          // Photon muet : on attend le résultat d'Overpass avant d'annoncer un échec
          return (complets[cle] || Promise.resolve()).then(() => {
            const x = geo[cle];
            if (!(x && x.alentours)) { alentoursMem[cle] = "erreur"; redessiner(); }
          });
        });
      lancerComplet(cle, pt);
    }
    return null;
  };

  /* ---------- liens de réservation ---------- */
  const sejour = (s) => {
    const d1 = s.debut, d2 = s.fin || s.debut;
    if (!d1) return null;
    const arrivee = veille(d1), depart = d2;
    return { arrivee, depart, nuits: Math.max(1, jours(arrivee, depart)) };
  };
  const lienAirbnb = (pt, sj) => {
    const dl = 0.09, dn = 0.13;
    const p = new URLSearchParams({
      refinement_paths: "/homes", search_by_map: "true", adults: "1",
      ne_lat: (pt.lat + dl).toFixed(5), ne_lng: (pt.lon + dn).toFixed(5),
      sw_lat: (pt.lat - dl).toFixed(5), sw_lng: (pt.lon - dn).toFixed(5),
      zoom: "11", price_filter_input_type: "0",
    });
    if (sj) { p.set("checkin", sj.arrivee); p.set("checkout", sj.depart); }
    return "https://www.airbnb.fr/s/homes?" + p.toString();
  };
  const lienBooking = (pt, sj, h, labelLieu) => {
    const p = new URLSearchParams({ group_adults: "1", no_rooms: "1", group_children: "0", lang: "fr" });
    if (sj) { p.set("checkin", sj.arrivee); p.set("checkout", sj.depart); }
    if (h) p.set("ss", h.nom + " " + (h.ville || ""));
    else { p.set("ss", labelLieu || ""); p.set("latitude", String(pt.lat)); p.set("longitude", String(pt.lon)); p.set("radius", "12"); p.set("order", "price"); }
    return "https://www.booking.com/searchresults.fr.html?" + p.toString();
  };
  const lienItineraire = (x) => "https://www.google.com/maps/dir/?api=1&destination=" + x.lat + "," + x.lon;
  const lienFiche = (x) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(x.nom + " " + (x.adresse || x.ville || ""));

  /* ---------- la vue « Carte » ---------- */
  let choisie = null, poiCourants = [];
  // Nos deux vues se redessinent quand une recherche aboutit ; on ne touche à rien ailleurs,
  // ni pendant qu'une fenêtre est ouverte, pour ne pas la faire disparaître sous les doigts.
  const NOS_VUES = ["carte", "rapports", "achats"];
  const redessiner = () => { if (L && NOS_VUES.includes(L.vue) && !document.querySelector("dialog[open]")) render(true); };

  const ligneZone = (km) => {
    const z = ZONES.find((x) => km <= x.max);
    const cat = ((bn && bn.cat) || []).filter((c) => c.actif !== false && String(c.nom || "").indexOf(z.ligne) === 0);
    return { z, cat };
  };

  P.vueCarte = () => {
    const boite = el("div", { class: "dp-carte-vue" });
    if (!geoCharge) { chargerGeo().then(redessiner); }
    const S = mesChantiers();
    if (!S.length) {
      boite.append(el("div", { class: "empty" }, el("h3", { text: "Aucun chantier à venir" }),
        el("p", { text: "Dès qu'un chantier est programmé, son lieu apparaît ici avec les hébergements, les restaurants et les boulangeries autour." })));
      return boite;
    }
    const auj = today();
    const s = S.find((x) => x.id === choisie) || S.find((x) => (x.debut || "") <= auj && (x.fin || x.debut || "") >= auj) || S[0];
    choisie = s.id;

    // bandeau des chantiers
    const onglets = el("div", { class: "dp-chantiers" });
    S.slice(0, 12).forEach((x) => {
      onglets.append(el("button", { class: "dp-ch" + (x.id === s.id ? " on" : ""), onclick: () => { choisie = x.id; poiCourants = []; redessiner(); } },
        el("b", { text: x.debut ? dfr(x.debut) : "date à venir" }),
        el("span", { text: x.client || "Client à préciser" }),
        el("small", { text: x.ouvrage || x.lieu || "" })));
    });
    boite.append(onglets);

    const cle = "session:" + s.id;
    const pt = geo[cle] || localiser(s);
    const sj = sejour(s);

    // entête du chantier : séjour conseillé, zone de déplacement, correction du lieu
    const tete = el("div", { class: "dp-tete" });
    const bloc = (titre, ...k) => el("div", { class: "dp-bloc" }, el("span", { text: titre }), ...k);
    tete.append(bloc("Chantier", el("b", { text: intitule(s) }), el("small", { text: (s.num_session ? "n° " + s.num_session + " · " : "") + (s.prestation || "") })));
    if (sj) {
      // repères de coût : les bases que DAM applique (0,60 €/km, 80 € la nuit, 25 € le repas)
      const repas = sj.nuits * 2;
      const cout = V() ? " · hébergement et repas ≈ " + eur(sj.nuits * 80 + repas * 25) + " (" + sj.nuits + " × 80 € + " + repas + " × 25 €)" : "";
      tete.append(bloc("Séjour conseillé", el("b", { text: "du " + dfr(sj.arrivee) + " au " + dfr(sj.depart) }),
        el("small", { text: sj.nuits + " nuit" + (sj.nuits > 1 ? "s" : "") + " · départ la veille, comme sur les devis" + cout })));
    }
    if (pt) {
      const dep = depart();
      const km = Math.round(dist(dep, pt) * 1.25);
      const zl = ligneZone(km);
      const detail = V() && zl.cat.length ? zl.cat.map((c) => c.nom.replace(/^Déplacement\s*/, "") + " : " + eur(c.tarif_jour)).join(" · ") : "";
      const auSiege = dep === SIEGE;
      const champDep = el("input", { type: "text", class: "dp-depart", placeholder: "commune + code postal", value: auSiege ? "" : dep.nom });
      const valider = () => P.changerDepart(champDep.value);
      champDep.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); valider(); } });
      tete.append(bloc("Déplacement depuis " + dep.nom, el("b", { text: "≈ " + km + " km par la route · zone " + zl.z.lib }),
        el("small", { text: detail || "Distance estimée (à vol d'oiseau + 25 %), à vérifier avant de chiffrer." }),
        el("div", { class: "dp-depart-ligne" },
          champDep,
          el("button", { class: "btn petit", text: "Partir d'ici", onclick: valider }),
          auSiege ? null : el("button", { class: "lien", text: "revenir au siège", onclick: () => P.changerDepart(SIEGE.nom) }))));
    }
    const champLieu = el("input", { type: "text", placeholder: "commune + code postal", value: (pt && pt.label) || s.lieu || "" });
    tete.append(bloc(pt ? "Lieu localisé" + (pt.manuel ? " (corrigé à la main)" : "") : "Lieu à préciser",
      champLieu,
      el("button", { class: "btn petit", text: "Localiser ici", onclick: () => { const v = champLieu.value.trim(); if (v) P.corrigerLieu(s, v); } }),
      el("small", { text: pt ? "" : "Le lieu n'a pas pu être trouvé automatiquement : tapez la commune." })));
    boite.append(tete);

    // la carte
    const zone = el("div", { class: "dp-carte-wrap" });
    const toile = el("div", { class: "dp-carte", id: "dp-carte", role: "region", "aria-label": "Carte du chantier" });
    zone.append(toile, el("div", { class: "dp-ctrl" },
      el("button", { text: "Chantier", onclick: () => survol(pt, 14.5) }),
      el("button", { text: "France", onclick: () => survol({ lat: 46.6, lon: 2.3 }, 4.8) }),
      el("button", { text: "Vue 3D / dessus", onclick: basculer3D }),
      el("button", { text: "Relief", onclick: basculerRelief })),
      el("div", { class: "dp-legende" },
        el("span", { class: "dp-p heb" }), "Hébergements ",
        el("span", { class: "dp-p res" }), "Restaurants ",
        el("span", { class: "dp-p boul" }), "Boulangeries"));
    boite.append(zone);

    if (!pt) {
      boite.append(el("p", { class: "hint", text: "Localisation du chantier en cours… Si rien n'apparaît, tapez la commune ci-dessus." }));
      return boite;
    }

    const a = alentours(cle, pt);
    if (sj) {
      boite.append(el("div", { class: "dp-reserver" },
        el("a", { class: "btn primary", href: lienAirbnb(pt, sj), target: "_blank", rel: "noopener", text: "Voir les Airbnb autour du chantier · " + sj.nuits + " nuit" + (sj.nuits > 1 ? "s" : "") }),
        el("a", { class: "btn", href: lienBooking(pt, sj, null, pt.label), target: "_blank", rel: "noopener", text: "Hôtels sur Booking, du moins cher au plus cher" }),
        el("small", { text: "Dates déjà remplies : arrivée la veille, départ le dernier jour du chantier." })));
    }

    if (a === "erreur") {
      boite.append(el("p", { class: "notice warn", text: "La recherche des hébergements et restaurants n'a pas abouti (serveurs OpenStreetMap occupés). Réessayez dans un instant." }),
        el("button", { class: "btn petit", text: "Réessayer", onclick: () => { delete alentoursMem[cle]; redessiner(); } }));
      return boite;
    }
    if (!a) {
      boite.append(el("div", { class: "dp-charge" }, el("span", { class: "dp-spin" }), "Recherche des hébergements, restaurants et boulangeries autour du chantier…"));
      return boite;
    }

    poiCourants = [
      ...a.heb.map((x) => Object.assign({ cat: "heb" }, x)),
      ...a.res.map((x) => Object.assign({ cat: "res" }, x)),
      ...a.boul.map((x) => Object.assign({ cat: "boul" }, x)),
    ];
    majPoi();

    const colonne = (titre, sous, L2, rendu, vide) => {
      const sec = el("section", { class: "dp-col" }, el("h3", null, titre, el("small", { text: sous })));
      if (!L2.length) sec.append(el("p", { class: "gris", text: vide }));
      else {
        const ol = el("ol", { class: "dp-liste" });
        L2.forEach((x) => {
          const i = poiCourants.indexOf(x);
          ol.append(el("li", null, ...rendu(x), el("button", { class: "lien dp-voir", text: "voir sur la carte", onclick: () => voirPoi(i) })));
        });
        sec.append(ol);
      }
      return sec;
    };
    const liens = (x, premier) => el("div", { class: "dp-act" },
      premier || null,
      el("a", { class: "lien", href: lienItineraire(x), target: "_blank", rel: "noopener", text: "itinéraire" }),
      el("a", { class: "lien", href: lienFiche(x), target: "_blank", rel: "noopener", text: "avis et photos" }),
      x.tel ? el("a", { class: "lien", href: "tel:" + x.tel.replace(/\s/g, ""), text: x.tel }) : null,
      x.site ? el("a", { class: "lien", href: x.site, target: "_blank", rel: "noopener", text: "site" }) : null);

    const grille = el("div", { class: "dp-grille" },
      colonne("Hébergements", " du moins cher au plus cher", a.heb, (x) => [
        el("div", { class: "dp-l1" }, el("b", { text: x.nom }), el("span", { class: "dp-gamme", text: x.gamme })),
        el("div", { class: "dp-l2", text: fmtD(x.d) + " du chantier · " + trajet(x.d) + (x.adresse ? " · " + x.adresse : "") }),
        liens(x, el("a", { class: "btn petit", href: lienBooking(pt, sj, x, pt.label), target: "_blank", rel: "noopener", text: "Réserver" })),
      ], "Aucun hébergement trouvé à moins de 12 km : passez par le bouton Airbnb ci-dessus."),
      colonne("Restaurants", " du moins cher au plus cher", a.res, (x) => [
        el("div", { class: "dp-l1" }, el("b", { text: x.nom }), el("span", { class: "dp-gamme", text: x.gamme })),
        el("div", { class: "dp-l2", text: x.type + " · " + fmtD(x.d) + " · " + trajet(x.d) + (x.horaires ? " · " + x.horaires : "") }),
        liens(x),
      ], "Aucun restaurant trouvé à moins de 6 km."),
      colonne("Boulangeries", " les plus proches", a.boul, (x) => [
        el("div", { class: "dp-l1" }, el("b", { text: x.nom })),
        el("div", { class: "dp-l2", text: fmtD(x.d) + " · " + trajet(x.d) + (x.horaires ? " · " + x.horaires : "") }),
        liens(x),
      ], "Aucune boulangerie trouvée à moins de 6 km."));
    boite.append(grille);
    boite.append(el("p", { class: "hint", text: "Données OpenStreetMap, actualisées le " + dfr(a.le) + (a.complet ? "" : " — étoiles, horaires et téléphones en cours d'ajout…") + ". Les gammes de prix sont estimées d'après le type d'établissement et les étoiles : le prix réel s'affiche sur Airbnb ou Booking, aux dates du séjour. Airbnb ne publie pas ses logements dans OpenStreetMap — le bouton ouvre la recherche Airbnb centrée sur le chantier, aux bonnes dates." }));
    boite.append(el("button", { class: "lien", text: "actualiser la recherche", onclick: () => { delete alentoursMem[cle]; delete complets[cle]; if (geo[cle]) { geo[cle].alentours = null; geo[cle].alentours_le = null; } redessiner(); } }));
    return boite;
  };

  /* ---------- moteur de carte (MapLibre, tuiles libres OpenFreeMap) ---------- */
  const VERSION_GL = "5.6.0";
  let gl = null, chargement = null, incline = true, relief = false, marqueur = null, popup = null, cleCadree = null;
  const chargerGL = () => chargement || (chargement = new Promise((ok, ko) => {
    if (window.maplibregl) return ok();
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://unpkg.com/maplibre-gl@" + VERSION_GL + "/dist/maplibre-gl.css"; document.head.append(l);
    const s = document.createElement("script"); s.src = "https://unpkg.com/maplibre-gl@" + VERSION_GL + "/dist/maplibre-gl.js";
    s.onload = () => ok(); s.onerror = () => ko(new Error("moteur de carte injoignable")); document.head.append(s);
    setTimeout(() => ko(new Error("délai dépassé")), 15000);
  }));
  const survol = (pt, zoom) => { if (gl && pt) gl.flyTo({ center: [pt.lon, pt.lat], zoom: zoom, pitch: incline ? 55 : 0, bearing: -18, duration: 2000, essential: true }); };
  const basculer3D = () => { incline = !incline; if (gl) gl.easeTo({ pitch: incline ? 55 : 0, bearing: incline ? -18 : 0, duration: 900 }); };
  const basculerRelief = () => {
    relief = !relief;
    if (gl) { try { gl.setTerrain(relief ? { source: "relief", exaggeration: 1.4 } : null); } catch (_) {} if (relief && gl.getPitch() < 40) gl.easeTo({ pitch: 55, duration: 800 }); }
  };
  const majPoi = () => {
    if (!gl || !gl.isStyleLoaded() || !gl.getSource("dp-poi")) return;
    gl.getSource("dp-poi").setData({
      type: "FeatureCollection",
      features: poiCourants.map((p, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { c: p.cat, i: i, n: p.nom } })),
    });
  };
  const fichePoi = (p) => "<b>" + echap(p.nom) + "</b><br><small>" + echap((p.gamme || "Boulangerie") + (p.type && p.cat === "res" ? " · " + p.type : "")) + " · " + fmtD(p.d) + "</small>"
    + (p.adresse ? "<br><small>" + echap(p.adresse) + "</small>" : "")
    + (p.horaires ? "<br><small>" + echap(p.horaires) + "</small>" : "")
    + '<br><a href="' + echap(lienItineraire(p)) + '" target="_blank" rel="noopener">itinéraire</a>';
  const echap = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ouvrirPoi = (i) => {
    const p = poiCourants[i]; if (!p || !gl || !window.maplibregl) return;
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ offset: 12, anchor: "bottom", maxWidth: "300px", className: "dp-popup" }).setLngLat([p.lon, p.lat]).setHTML(fichePoi(p)).addTo(gl);
  };
  const voirPoi = (i) => {
    const p = poiCourants[i]; if (!p) return;
    const c = document.querySelector("#dp-carte"); if (c) c.scrollIntoView({ behavior: "smooth", block: "center" });
    if (gl) { gl.flyTo({ center: [p.lon, p.lat], zoom: 16.5, pitch: incline ? 58 : 0, duration: 1800, essential: true }); gl.once("moveend", () => ouvrirPoi(i)); }
  };
  const calques = (map) => {
    try { map.setProjection({ type: "globe" }); } catch (_) {}
    try {
      map.addSource("relief", { type: "raster-dem", tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"], encoding: "terrarium", tileSize: 512, maxzoom: 12, attribution: "© Mapterhorn" });
      const sym = (map.getStyle().layers.find((l) => l.type === "symbol") || {}).id;
      map.addLayer({ id: "dp-ombrage", type: "hillshade", source: "relief", maxzoom: 14, paint: { "hillshade-exaggeration": 0.45 } }, sym);
      if (relief) map.setTerrain({ source: "relief", exaggeration: 1.4 });
    } catch (e) { parle("relief : " + (e.message || e)); }
    map.addSource("dp-poi", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "dp-poi-cercle", type: "circle", source: "dp-poi",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 14, 8, 18, 12],
        "circle-color": ["match", ["get", "c"], "heb", "#1565C0", "res", "#eb6834", "#a0662b"],
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-pitch-alignment": "map",
      },
    });
    map.addLayer({
      id: "dp-poi-lettre", type: "symbol", source: "dp-poi", minzoom: 13,
      layout: { "text-field": ["match", ["get", "c"], "heb", "H", "res", "R", "B"], "text-font": ["Noto Sans Bold"], "text-size": 10, "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#ffffff" },
    });
    map.on("click", "dp-poi-cercle", (ev) => { const f = ev.features && ev.features[0]; if (f) ouvrirPoi(+f.properties.i); });
    map.on("mouseenter", "dp-poi-cercle", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "dp-poi-cercle", () => { map.getCanvas().style.cursor = ""; });
    majPoi();
  };
  const demarrerCarte = (hote, pt, s) => {
    if (!window.maplibregl) return;
    if (gl) { try { gl.remove(); } catch (_) {} gl = null; }
    gl = new maplibregl.Map({
      container: hote, style: "https://tiles.openfreemap.org/styles/liberty",
      center: [pt.lon, pt.lat], zoom: 13.5, pitch: incline ? 52 : 0, bearing: -18, maxPitch: 78,
      attributionControl: { compact: true }, pixelRatio: Math.min(window.devicePixelRatio || 1, 1.25),
      fadeDuration: 120, maxTileCacheSize: 300, canvasContextAttributes: { antialias: false },
    });
    gl.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    gl.addControl(new maplibregl.FullscreenControl(), "top-left");
    gl.on("style.load", () => calques(gl));
    const marque = document.createElement("div");
    marque.className = "dp-pin";
    marque.innerHTML = "<span></span><i></i>";
    marque.title = intitule(s);
    marqueur = new maplibregl.Marker({ element: marque, anchor: "bottom" }).setLngLat([pt.lon, pt.lat])
      .setPopup(new maplibregl.Popup({ offset: 30, maxWidth: "300px", className: "dp-popup" })
        .setHTML("<b>" + echap(intitule(s)) + "</b><br><small>" + echap(pt.label || s.lieu || "") + "</small>"))
      .addTo(gl);
  };
  // la carte est (re)posée après chaque affichage de la vue
  const poser = () => {
    const hote = document.querySelector("#dp-carte");
    if (!hote || hote.dataset.pret) return;
    const s = (L.missions || []).find((x) => x.id === choisie);
    const pt = geo["session:" + choisie];
    if (!s || !pt) return;
    hote.dataset.pret = "1";
    const cle = choisie + "|" + pt.lat;
    chargerGL().then(() => {
      if (!document.querySelector("#dp-carte")) return;
      if (gl && cle === cleCadree) { // même chantier : on remet la carte en place sans la recréer
        document.querySelector("#dp-carte").replaceWith(gl.getContainer());
        gl.resize(); majPoi(); return;
      }
      cleCadree = cle;
      demarrerCarte(document.querySelector("#dp-carte"), pt, s);
    }).catch((e) => {
      const h = document.querySelector("#dp-carte");
      if (h) h.replaceChildren(el("p", { class: "notice warn", text: "La carte 3D n'a pas pu se charger (" + (e.message || e) + "). La liste des hébergements et des restaurants reste utilisable." }));
    });
  };
  P.quitterCarte = () => { if (gl) { try { gl.remove(); } catch (_) {} } gl = null; marqueur = null; popup = null; cleCadree = null; };

  /* ===========================================================
     3. RAPPORTS DÉPOSÉS (côté direction)

     Un géomètre dépose un rapport, le gérant reçoit la notification sur son téléphone,
     mais rien ne lui disait à quel chantier ce rapport appartenait : il fallait ouvrir
     les sessions une par une. Cet onglet les rassemble, dit lesquels restent à envoyer,
     et mène d'un clic à la fenêtre d'envoi du bon chantier, adresse déjà remplie.
     =========================================================== */
  const rapportsDe = (sid) => ((L && L.docs) || []).filter((d) => d.missionId === sid && d.categorie === "rapport");
  const envoisRapportDe = (sid) => ((bn && bn.envois) || [])
    .filter((e) => e.session_id === sid && e.nature === "rapport" && e.statut !== "echec")
    .sort((a, b) => String(b.le || "").localeCompare(String(a.le || "")));
  const dejaEnvoyes = (sid) => {
    const s = new Set();
    envoisRapportDe(sid).forEach((e) => (e.documents_ids || []).forEach((x) => s.add(x)));
    return s;
  };
  const nomSalarie = (id) => {
    const S = (L && L.salaries) || {};
    const x = S[id];
    return (x && (x.nom || x.prenom)) || "";
  };
  const dossierDeSession = (sid) => {
    const l = ((bn && bn.liens) || []).find((x) => x.session_id === sid);
    return l ? ((bn && bn.dos) || []).find((d) => d.id === l.dossier_id) : null;
  };

  /* Un dossier de travail par chantier ayant au moins un rapport déposé. */
  const chantiersAvecRapports = () => {
    const M = (L && L.missions) || [];
    return M.map((s) => {
      const R = rapportsDe(s.id);
      if (!R.length) return null;
      const envoyes = dejaEnvoyes(s.id);
      const E = envoisRapportDe(s.id);
      const aEnvoyer = R.filter((d) => !envoyes.has(d.id));
      const depot = R.map((d) => d.le || "").sort().pop() || "";
      return { s, R, aEnvoyer, envois: E, dernierEnvoi: E[0] || null, depot };
    }).filter(Boolean)
      .sort((a, b) => (b.aEnvoyer.length > 0) - (a.aEnvoyer.length > 0) || String(b.depot).localeCompare(String(a.depot)));
  };

  /* Pastille chiffrée sur l'onglet : combien de chantiers attendent un envoi. */
  P.nbRapports = () => {
    try { return V() ? chantiersAvecRapports().filter((x) => x.aEnvoyer.length).length : 0; }
    catch (_) { return 0; }
  };

  /* Emmène le gérant sur le chantier voulu et ouvre la fenêtre d'envoi des rapports.
     On réutilise le bouton « Envoyer au client » que le programme principal dessine
     déjà sur la session : rien n'est réécrit, on clique simplement à sa place. */
  P.allerEnvoiRapport = (s) => {
    try {
      L.vue = "prestations";
      L.nav = { presta: s.prestation, client: s.client, session: s.id };
      render(true);
      window.scrollTo({ top: 0 });
      let essais = 0;
      const clic = () => {
        const b = document.getElementById("env-rap-" + s.id);
        if (b) { b.click(); return; }
        if (++essais < 40) setTimeout(clic, 120);   // la vue peut mettre un instant à se dessiner
      };
      setTimeout(clic, 100);
    } catch (e) { parle("allerEnvoiRapport : " + (e.message || e)); }
  };

  P.vueRapports = () => {
    const boite = el("div", { class: "dp-rap-vue" });
    if (!V()) { boite.append(el("p", { class: "hint", text: "Réservé à la direction." })); return boite; }

    const tout = chantiersAvecRapports();
    if (!tout.length) {
      boite.append(el("div", { class: "empty" }, el("h3", { text: "Aucun rapport déposé" }),
        el("p", { text: "Dès qu'un géomètre dépose un rapport, le chantier concerné apparaît ici." })));
      return boite;
    }
    const attente = tout.filter((x) => x.aEnvoyer.length);
    const faits = tout.filter((x) => !x.aEnvoyer.length);

    const ligne = (x) => {
      const s = x.s, neuf = x.aEnvoyer.length;
      const d = dossierDeSession(s.id);
      const adresse = (d && P.adresseDossier(d)) || "";
      const chantier = [s.ouvrage, s.lieu].filter(Boolean).join(" · ") || "chantier non précisé";
      const qui = [...new Set(x.aEnvoyer.map((f) => nomSalarie(f.par)).filter(Boolean))].join(", ");
      const der = x.dernierEnvoi;

      const bouton = el("button", {
        class: "btn " + (neuf ? "primary" : ""),
        text: der ? (neuf ? "Envoyer les nouveaux" : "Renvoyer") : "Envoyer au client",
        onclick: () => P.allerEnvoiRapport(s),
      });

      return el("div", { class: "dp-rap" + (neuf ? " neuf" : "") },
        el("div", { class: "dp-rap-jour" },
          el("b", { text: x.depot ? dfr(String(x.depot).slice(0, 10)) : "—" }),
          el("small", { text: s.num_session ? "n° " + s.num_session : "" })),
        el("div", { class: "dp-rap-corps" },
          el("b", { text: s.client || "Client à préciser" }),
          el("span", { class: "dp-rap-ch", text: chantier }),
          el("small", { text: x.R.length + " fichier" + (x.R.length > 1 ? "s" : "")
            + (neuf ? " · " + neuf + " jamais envoyé" + (neuf > 1 ? "s" : "") : " · tous envoyés")
            + (qui ? " · déposé par " + qui : "") }),
          el("small", { class: "dp-rap-fic", text: x.aEnvoyer.slice(0, 3).map((f) => f.nom).join(" · ")
            + (x.aEnvoyer.length > 3 ? " …" : "") }),
          der ? el("small", { class: "dp-rap-deja",
            text: "Déjà envoyé le " + dfr(String(der.le || "").slice(0, 10)) + (der.destinataires ? " à " + der.destinataires : "") }) : null,
          adresse ? el("small", { class: "dp-rap-adr", text: "Partira à " + adresse }) : null),
        el("div", { class: "dp-rap-act" }, bouton));
    };

    if (attente.length) {
      boite.append(el("h3", { class: "dp-rap-titre", text: "À envoyer au client — " + attente.length + " chantier" + (attente.length > 1 ? "s" : "") }));
      attente.forEach((x) => boite.append(ligne(x)));
    }
    if (faits.length) {
      boite.append(el("h3", { class: "dp-rap-titre second", text: "Déjà envoyés" }));
      faits.forEach((x) => boite.append(ligne(x)));
    }
    boite.append(el("p", { class: "hint", text: "Un clic ouvre la fenêtre d'envoi du bon chantier, avec les rapports non encore envoyés déjà cochés et l'adresse du client pré-remplie." }));
    return boite;
  };

  /* ===========================================================
     4. FACTURES FOURNISSEUR (côté direction)

     Les factures d'achat hors chantier — téléphone, carburant, assurances,
     matériel — arrivent par mail. L'espace relève la boîte, les range ici,
     et le gérant décide lesquelles partent dans Pennylane. L'état du paiement
     et sa date reviennent ensuite de Pennylane.
     =========================================================== */
  let achats = [], achatsCharges = false, achatOccupe = "";

  const chargerAchats = async () => {
    if (!V()) return;
    try {
      const r = await K.from("factures_fournisseur").select("*").order("recu_le", { ascending: false }).limit(300);
      if (r.error) throw r.error;
      achats = r.data || []; achatsCharges = true;
      redessiner();
    } catch (e) { parle("factures fournisseur : " + (e.message || e)); achatsCharges = true; }
  };
  P.rechargerAchats = chargerAchats;

  P.nbFournisseurs = () => {
    try { return V() ? achats.filter((f) => f.statut === "a_verifier").length : 0; }
    catch (_) { return 0; }
  };

  const EXPLICATIONS = {
    "546": "le serveur a interrompu l'opération, trop longue pour lui. Recliquez : elle reprendra où elle s'est arrêtée.",
    "403": "action réservée à la direction.",
    "504": "le serveur n'a pas répondu à temps. Recliquez dans un instant.",
  };
  const appelFournisseurs = async (corps) => {
    const { data, error } = await K.functions.invoke("fournisseurs", { body: corps });
    if (!error) return data;
    // sans message clair, l'espace affichait « non-2xx status code » : illisible.
    let detail = "", code = "";
    try { code = String((error.context && error.context.status) || ""); } catch (_) {}
    try { const j = await error.context.json(); detail = j.detail || j.erreur || ""; } catch (_) {}
    throw new Error(detail || EXPLICATIONS[code] || (code ? "erreur " + code : error.message || "appel impossible"));
  };

  const majAchat = async (f, champs) => {
    Object.assign(f, champs);
    redessiner();
    try {
      const r = await K.from("factures_fournisseur").update(champs).eq("id", f.id);
      if (r.error) throw r.error;
    } catch (e) { alert("Enregistrement impossible : " + (e.message || e)); chargerAchats(); }
  };

  const ouvrirPdf = async (f) => {
    if (!f.chemin) { alert("Le PDF de cette facture n'a pas été retrouvé."); return; }
    try {
      const r = await K.storage.from("factures-fournisseur").createSignedUrl(f.chemin, 300);
      if (r.error || !r.data) throw r.error || new Error("lien indisponible");
      window.open(r.data.signedUrl, "_blank", "noopener");
    } catch (e) { alert("Ouverture impossible : " + (e.message || e)); }
  };

  const ETATS = {
    a_verifier: { lib: "À vérifier", cl: "att" },
    deposee: { lib: "Déposée dans Pennylane", cl: "dep" },
    payee: { lib: "Payée", cl: "pay" },
    ecartee: { lib: "Écartée", cl: "ecl" },
  };

  P.vueFournisseurs = () => {
    const boite = el("div", { class: "dp-ach-vue" });
    if (!V()) { boite.append(el("p", { class: "hint", text: "Réservé à la direction." })); return boite; }
    if (!achatsCharges) { chargerAchats(); }

    /* barre d'actions */
    const etat = el("span", { class: "dp-ach-etat", text: achatOccupe || "" });
    const relever = el("button", { class: "btn primary", text: "Relever ma boîte mail", disabled: !!achatOccupe,
      onclick: async () => {
        achatOccupe = "Lecture de la boîte mail…"; redessiner();
        try {
          // par petits lots : la boîte peut contenir beaucoup de mails, et le serveur
          // coupe une opération trop longue. On relit jusqu'à ce qu'il n'en reste plus.
          const r = await appelFournisseurs({ action: "relever", jours: 21, lot: 3 });
          achatOccupe = "";
          await chargerAchats();
          alert(r.ajoutees + " nouvelle(s) facture(s) ajoutée(s), sur " + r.lus + " message(s) examiné(s) en " + r.secondes + " s."
            + (r.reste ? "\n\nIl reste " + r.reste + " message(s) à examiner : recliquez sur « Relever ma boîte mail »." : "\n\nTout est à jour."));
        } catch (e) { achatOccupe = ""; redessiner(); alert("Relève impossible : " + (e.message || e)); }
      } });
    const synchro = el("button", { class: "btn", text: "Mettre à jour les paiements", disabled: !!achatOccupe,
      onclick: async () => {
        achatOccupe = "Interrogation de Pennylane…"; redessiner();
        try {
          const r = await appelFournisseurs({ action: "synchro" });
          achatOccupe = ""; await chargerAchats();
          alert((r.factures || []).length + " facture(s) vérifiée(s) auprès de Pennylane.");
        } catch (e) { achatOccupe = ""; redessiner(); alert("Mise à jour impossible : " + (e.message || e)); }
      } });
    boite.append(el("div", { class: "dp-ach-barre" }, relever, synchro, etat));

    if (!achats.length) {
      boite.append(el("div", { class: "empty" }, el("h3", { text: "Aucune facture d'achat" }),
        el("p", { text: "Cliquez sur « Relever ma boîte mail » : les factures reçues en pièce jointe seront listées ici." })));
      return boite;
    }

    /* totaux utiles */
    const somme = (l) => l.reduce((s, f) => s + (Number(f.total_ttc) || 0), 0);
    const aPayer = achats.filter((f) => f.statut === "deposee");
    const aVoir = achats.filter((f) => f.statut === "a_verifier");
    boite.append(el("div", { class: "dp-ach-chiffres" },
      el("div", null, el("b", { text: String(aVoir.length) }), el("span", { text: "à vérifier" })),
      el("div", null, el("b", { text: String(aPayer.length) }), el("span", { text: "déposées, en attente de paiement" })),
      el("div", null, el("b", { text: eur(somme(aPayer)) }), el("span", { text: "restant à payer" }))));

    const ligne = (f) => {
      const e = ETATS[f.statut] || ETATS.a_verifier;
      const actions = el("div", { class: "dp-ach-act" });
      actions.append(el("button", { class: "btn petit", text: "Voir le PDF", onclick: () => ouvrirPdf(f) }));
      if (f.statut === "a_verifier") {
        actions.append(el("button", { class: "btn petit primary", text: "Déposer dans Pennylane",
          onclick: async () => {
            achatOccupe = "Dépôt de « " + (f.nom || "la facture") + " »…"; redessiner();
            try { await appelFournisseurs({ action: "deposer", id: f.id }); achatOccupe = ""; await chargerAchats(); }
            catch (x) { achatOccupe = ""; redessiner(); alert("Dépôt refusé : " + (x.message || x)); }
          } }));
        actions.append(el("button", { class: "lien", text: "ce n'est pas une facture",
          onclick: () => { if (confirm("Écarter « " + (f.nom || "ce document") + " » ? Elle restera consultable mais ne sera plus proposée.")) majAchat(f, { statut: "ecartee" }); } }));
      }
      if (f.statut === "ecartee") {
        actions.append(el("button", { class: "lien", text: "remettre dans la liste", onclick: () => majAchat(f, { statut: "a_verifier" }) }));
      }

      const montant = f.total_ttc != null ? eur(f.total_ttc) : (f.total_ht != null ? eur(f.total_ht) + " HT" : "montant non lu");
      return el("div", { class: "dp-ach" + (f.statut === "a_verifier" ? " neuf" : "") },
        el("div", { class: "dp-ach-jour" },
          el("b", { text: f.recu_le ? dfr(String(f.recu_le).slice(0, 10)) : "—" }),
          el("span", { class: "dp-ach-badge " + e.cl, text: e.lib })),
        el("div", { class: "dp-ach-corps" },
          el("b", { text: f.fournisseur || f.expediteur || "Fournisseur inconnu" }),
          el("span", { class: "dp-ach-mt", text: montant + (f.numero ? " · facture n° " + f.numero : "") }),
          el("small", { text: (f.date_facture ? "datée du " + dfr(f.date_facture) : "")
            + (f.date_echeance ? " · à payer avant le " + dfr(f.date_echeance) : "") }),
          el("small", { class: "dp-ach-fic", text: f.nom || "" }),
          f.date_paiement ? el("small", { class: "dp-ach-paye", text: "Payée le " + dfr(f.date_paiement) }) : null,
          f.pennylane_statut === "echec_depot" ? el("small", { class: "dp-ach-ko", text: "Le dépôt dans Pennylane a échoué — réessayez." }) : null),
        actions);
    };

    const bloc = (titre, liste) => {
      if (!liste.length) return;
      boite.append(el("h3", { class: "dp-ach-titre", text: titre + " — " + liste.length }));
      liste.forEach((f) => boite.append(ligne(f)));
    };
    bloc("À vérifier", aVoir);
    bloc("Déposées, en attente de paiement", aPayer);
    bloc("Payées", achats.filter((f) => f.statut === "payee"));
    bloc("Écartées", achats.filter((f) => f.statut === "ecartee"));

    boite.append(el("p", { class: "hint", text: "Rien ne part dans Pennylane sans votre clic. L'état du paiement et sa date viennent de Pennylane, une fois le rapprochement bancaire fait." }));
    return boite;
  };

  /* ===========================================================
     5. OUTILLAGE : styles et surveillance de l'affichage
     =========================================================== */
  /* L'onglet « Carte » n'a pas d'icône dans le programme principal : celui-ci écrit alors
     le mot « undefined » devant le libellé. On pose l'icône nous-mêmes (une épingle de carte). */
  const EPINGLE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
  const FEUILLE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h5"></path></svg>';
  const RECU = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"></path><path d="M8 8h8"></path><path d="M8 12h8"></path><path d="M8 16h5"></path></svg>';
  const ICONES = { Carte: EPINGLE, Rapports: FEUILLE, Achats: RECU };
  const reparerOnglet = () => {
    document.querySelectorAll('button[role="tab"]').forEach((b) => {
      if (b.dataset.dpOnglet) return;
      const lib = b.querySelector("span");
      const nom = lib ? (lib.textContent || "").trim() : "";
      if (!ICONES[nom]) return;
      b.dataset.dpOnglet = "1";
      Array.from(b.childNodes).forEach((n) => {
        if (n.nodeType === 3 && n.textContent.indexOf("undefined") >= 0) n.remove();
      });
      if (!b.querySelector("svg")) {
        const d = document.createElement("span");
        d.innerHTML = ICONES[nom];
        if (d.firstChild) b.prepend(d.firstChild);
      }
    });
  };

  const observer = () => {
    const passe = () => {
      try {
        reparerOnglet();
        enrichirChamps();
        if (L && L.vue === "carte") poser();
        else if (gl) P.quitterCarte(); // on arrête la carte dès qu'on quitte l'onglet : plus aucun calcul en arrière-plan
      } catch (e) { parle(e.message || e); }
    };
    let minuteur = null;
    new MutationObserver(() => { clearTimeout(minuteur); minuteur = setTimeout(passe, 120); })
      .observe(document.body, { childList: true, subtree: true });
    setTimeout(passe, 400);
  };

  const styles = () => {
    if (document.getElementById("dp-styles")) return;
    const s = document.createElement("style");
    s.id = "dp-styles";
    s.textContent = `
.dp-ach-barre{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.dp-ach-etat{font-size:12.5px;color:#64748b}
.dp-ach-chiffres{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.dp-ach-chiffres>div{flex:1 1 150px;border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;background:#fff}
.dp-ach-chiffres b{display:block;font-size:17px;color:#0E3F78}
.dp-ach-chiffres span{font-size:11.5px;color:#64748b}
.dp-ach-titre{margin:20px 0 8px;font-size:15px;color:#0E3F78}
.dp-ach{display:flex;gap:12px;align-items:flex-start;padding:11px 13px;margin-bottom:8px;border:1px solid #e2e8f0;border-radius:11px;background:#fff}
.dp-ach.neuf{border-color:#9dc1ea;background:#f6fafe}
.dp-ach-jour{min-width:104px;display:flex;flex-direction:column;gap:4px}
.dp-ach-jour b{font-size:13px;color:#0E3F78}
.dp-ach-badge{display:inline-block;font-size:10.5px;padding:2px 7px;border-radius:999px;background:#eef2f7;color:#51607a;width:fit-content}
.dp-ach-badge.att{background:#fff4e0;color:#8a5a00}
.dp-ach-badge.dep{background:#e7f0fb;color:#0E3F78}
.dp-ach-badge.pay{background:#e6f6ec;color:#2f7d4f}
.dp-ach-badge.ecl{background:#f1f3f6;color:#8595a8}
.dp-ach-corps{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dp-ach-corps b{font-size:14px}
.dp-ach-mt{font-size:13px;color:#0E3F78;font-weight:600}
.dp-ach-corps small{font-size:11.5px;color:#6b7a8d}
.dp-ach-fic{color:#8595a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-ach-paye{color:#2f7d4f;font-weight:600}
.dp-ach-ko{color:#b4232a;font-weight:600}
.dp-ach-act{display:flex;flex-direction:column;gap:5px;align-items:flex-end}
@media(max-width:640px){.dp-ach{flex-wrap:wrap}.dp-ach-act{width:100%;flex-direction:row;flex-wrap:wrap}}
.dp-rap-titre{margin:14px 0 8px;font-size:15px;color:#0E3F78}
.dp-rap-titre.second{margin-top:26px;color:#6b7a8d;font-weight:600}
.dp-rap{display:flex;gap:12px;align-items:flex-start;padding:11px 13px;margin-bottom:8px;border:1px solid #e2e8f0;border-radius:11px;background:#fff}
.dp-rap.neuf{border-color:#9dc1ea;background:#f6fafe}
.dp-rap-jour{min-width:92px;display:flex;flex-direction:column;gap:2px}
.dp-rap-jour b{font-size:13px;color:#0E3F78}
.dp-rap-jour small{font-size:11px;color:#8595a8}
.dp-rap-corps{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dp-rap-corps b{font-size:14px}
.dp-rap-ch{font-size:12.5px;color:#44566c}
.dp-rap-corps small{font-size:11.5px;color:#6b7a8d}
.dp-rap-fic{color:#8595a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-rap-deja{color:#2f7d4f}
.dp-rap-adr{color:#0E3F78;font-weight:600}
.dp-rap-act{display:flex;align-items:center}
@media(max-width:620px){.dp-rap{flex-wrap:wrap}.dp-rap-act{width:100%}.dp-rap-act .btn{width:100%}}
.dp-depart-ligne{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
.dp-depart{flex:1 1 140px;min-width:120px;padding:4px 7px;border:1px solid #cfdae8;border-radius:7px;font-size:12px}
.dp-carnet{margin:-6px 0 14px;padding:10px 12px;border:1px solid #dfe7f2;border-radius:10px;background:#f6f9fd}
.dp-pourquoi{margin:0 0 8px;font-size:13px;color:#0E3F78;font-weight:600}
.dp-puces{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dp-puces .dp-t{font-size:12px;color:#5b6b80;margin-right:4px}
.dp-puce{display:inline-flex;align-items:stretch;border:1px solid #c9d8ea;border-radius:999px;overflow:hidden;background:#fff}
.dp-puce button{border:0;background:none;font:inherit;font-size:12px;padding:5px 10px;cursor:pointer;color:#17324f}
.dp-puce button:hover{background:#e8f1fc}
.dp-puce.factu{border-color:#2BB673}
.dp-puce.factu button:first-child{color:#13704a;font-weight:600}
.dp-puce .dp-cc{border-left:1px solid #dde7f1;color:#5b6b80;padding:5px 8px}
.dp-note{margin:8px 0 0;font-size:12px;color:#6b7b90}
.dp-aide{display:block;margin-top:4px;font-size:12px;color:#6b7b90}
.dp-chantiers{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:14px}
.dp-ch{flex:0 0 auto;text-align:left;border:1px solid #dfe7f2;background:#fff;border-radius:12px;padding:8px 12px;cursor:pointer;min-width:170px}
.dp-ch b{display:block;font-size:13px;color:#1565C0}
.dp-ch span{display:block;font-size:14px;font-weight:600;color:#17324f}
.dp-ch small{display:block;font-size:12px;color:#6b7b90;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}
.dp-ch.on{border-color:#1565C0;box-shadow:0 0 0 2px #cfe2f8}
.dp-tete{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-bottom:14px}
.dp-bloc{border:1px solid #e6ecf4;border-radius:12px;padding:10px 12px;background:#fff}
.dp-bloc>span{display:block;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#8292a6;margin-bottom:4px}
.dp-bloc b{font-size:15px;color:#17324f}
.dp-bloc small{display:block;font-size:12px;color:#6b7b90;margin-top:3px}
.dp-bloc input{width:100%;margin:2px 0 6px;padding:6px 8px;border:1px solid #cfd9e6;border-radius:8px;font:inherit}
.dp-carte-wrap{position:relative;margin-bottom:12px}
.dp-carte{height:460px;border-radius:14px;overflow:hidden;background:#e8eef6}
.dp-ctrl{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:6px;z-index:2}
.dp-ctrl button{border:1px solid #cfd9e6;background:rgba(255,255,255,.94);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}
.dp-legende{display:flex;align-items:center;gap:6px;font-size:12px;color:#5b6b80;margin-top:6px}
.dp-p{display:inline-block;width:11px;height:11px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #c3cfdd}
.dp-p.heb{background:#1565C0}.dp-p.res{background:#eb6834}.dp-p.boul{background:#a0662b}
.dp-reserver{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 16px}
.dp-reserver small{flex:1 1 100%;font-size:12px;color:#6b7b90}
.dp-grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.dp-col h3{font-size:15px;margin:0 0 8px;color:#0E3F78}
.dp-col h3 small{font-weight:400;color:#8292a6;font-size:12px}
.dp-liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.dp-liste li{border:1px solid #e6ecf4;border-radius:10px;padding:9px 11px;background:#fff}
.dp-l1{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.dp-l1 b{font-size:14px;color:#17324f}
.dp-gamme{font-size:11px;color:#13704a;background:#e7f7ef;border-radius:999px;padding:2px 8px;white-space:nowrap}
.dp-l2{font-size:12px;color:#6b7b90;margin-top:2px}
.dp-act{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px}
.dp-act .lien,.dp-voir{font-size:12px}
.dp-voir{display:block;margin-top:4px}
.dp-charge{display:flex;align-items:center;gap:10px;color:#5b6b80;font-size:14px;padding:16px 0}
.dp-spin{width:16px;height:16px;border:2px solid #cfe2f8;border-top-color:#1565C0;border-radius:50%;animation:dp-t 1s linear infinite}
@keyframes dp-t{to{transform:rotate(360deg)}}
.dp-pin span{display:block;width:18px;height:18px;border-radius:50%;background:#2BB673;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.dp-pin i{display:block;width:2px;height:16px;margin:0 auto;background:#2BB673}
.dp-popup .maplibregl-popup-content{font:14px/1.45 Outfit,system-ui,sans-serif;border-radius:10px;padding:10px 12px}
.dp-gris,.gris{color:#8292a6;font-size:13px}
@media(max-width:700px){.dp-carte{height:340px}}
`;
    document.head.append(s);
  };
})();
