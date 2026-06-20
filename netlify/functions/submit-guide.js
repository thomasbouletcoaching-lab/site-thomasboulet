// Fonction serverless Netlify — reçoit les données du formulaire guide,
// crée/met à jour le contact dans Brevo, ET déclenche l'envoi d'un email
// transactionnel contenant le lien de téléchargement du guide PDF.
//
// La clé API Brevo n'est JAMAIS visible côté navigateur : elle est lue
// depuis une variable d'environnement Netlify (BREVO_API_KEY), à
// configurer dans Site settings → Environment variables de CE site
// (site-thomasboulet), exactement comme pour le site du quiz.

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Méthode non autorisée" }),
    };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Corps de requête invalide" }),
    };
  }

  const { prenom, nom, email, tel } = data;

  if (!prenom || !email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Prénom et email sont obligatoires" }),
    };
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    console.error("BREVO_API_KEY non configurée dans les variables d'environnement Netlify");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Configuration serveur manquante" }),
    };
  }

  // URL publique du guide PDF — adapte le domaine si besoin
  const GUIDE_PDF_URL = "https://thomasbouletcoaching.netlify.app/3h%20qui%20changent%20tout.pdf";

  // ── 1. Construction du contact Brevo ──
  const attributes = { FIRSTNAME: prenom };
  if (nom) attributes.LASTNAME = nom;
  if (tel) {
    let smsValue = tel.replace(/\s+/g, "");
    if (smsValue.startsWith("0")) {
      smsValue = "33" + smsValue.slice(1);
    } else if (smsValue.startsWith("+")) {
      smsValue = smsValue.slice(1);
    }
    attributes.SMS = smsValue;
  }
  attributes.OBJECTIF = "guide";
  attributes.NIVEAU_ENGAGEMENT = "opt-in";
  attributes.SOURCE = "page_guide";

  const contactPayload = {
    email: email,
    attributes: attributes,
    updateEnabled: true,
    listIds: [5], // Liste "Leads Diagnostic" — même liste que le quiz
  };

  let contactCreated = false;

  try {
    let response = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify(contactPayload),
    });

    if (response.status === 201 || response.status === 204) {
      contactCreated = true;
    } else {
      let errorBody = await response.text();
      let parsedError;
      try { parsedError = JSON.parse(errorBody); } catch (e) { parsedError = {}; }

      // Retry sans le SMS si conflit de doublon (même logique que le quiz)
      if (
        response.status === 400 &&
        parsedError.code === "duplicate_parameter" &&
        parsedError.metadata &&
        parsedError.metadata.duplicate_identifiers &&
        parsedError.metadata.duplicate_identifiers.includes("SMS")
      ) {
        const payloadWithoutSms = { ...contactPayload, attributes: { ...contactPayload.attributes } };
        delete payloadWithoutSms.attributes.SMS;

        response = await fetch("https://api.brevo.com/v3/contacts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "api-key": BREVO_API_KEY,
          },
          body: JSON.stringify(payloadWithoutSms),
        });

        if (response.status === 201 || response.status === 204) {
          contactCreated = true;
        } else {
          console.error("Erreur Brevo (contact, retry sans SMS):", await response.text());
        }
      } else {
        console.error("Erreur Brevo (contact):", response.status, errorBody);
      }
    }
  } catch (err) {
    console.error("Erreur réseau vers Brevo (contact):", err);
  }

  // ── 2. Envoi de l'email transactionnel avec le lien du guide ──
  let emailSent = false;

  try {
    const emailPayload = {
      sender: { name: "Thomas Boulet Coaching", email: "thomasboulet.coaching@gmail.com" },
      to: [{ email: email, name: prenom }],
      subject: "Ton guide \"3H Qui Changent Tout\" est prêt 📘",
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #0B1220;">
          <h2 style="color:#0B1220;">Salut ${prenom},</h2>
          <p>Merci d'avoir téléchargé <strong>3H Qui Changent Tout</strong> — le guide complet pour reconstruire ton corps en 3h par semaine.</p>
          <p style="text-align:center; margin: 32px 0;">
            <a href="${GUIDE_PDF_URL}" style="background:#C8551B; color:#ffffff; padding:14px 28px; border-radius:6px; text-decoration:none; font-weight:bold; display:inline-block;">
              📘 Télécharger mon guide
            </a>
          </p>
          <p>Pendant que tu le lis, si tu veux savoir exactement où tu en es, fais le <a href="https://thomasboulet-diagnosticsituation.netlify.app" style="color:#C8551B;">diagnostic gratuit en 3 minutes</a>.</p>
          <p>À très vite,<br>Thomas</p>
          <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
          <p style="font-size:12px;color:#888;">Thomas Boulet Coaching — @thomasboulet.coaching</p>
        </div>
      `,
    };

    const emailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify(emailPayload),
    });

    if (emailResponse.status === 201) {
      emailSent = true;
    } else {
      console.error("Erreur Brevo (email):", emailResponse.status, await emailResponse.text());
    }
  } catch (err) {
    console.error("Erreur réseau vers Brevo (email):", err);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, contactCreated, emailSent }),
  };
};
