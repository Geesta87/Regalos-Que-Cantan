import React, { useContext } from 'react';
import { AppContext } from '../App';

const css = `
.terms-bg {
  min-height: 100vh;
  background: #0a0a0f;
  font-family: 'Inter', 'Nunito', -apple-system, BlinkMacSystemFont, sans-serif;
  color: #cbd5e1;
  padding: 0 20px 80px;
}
.terms-header {
  background: rgba(10,10,15,0.95);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 14px 28px;
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(12px);
}
.terms-header-inner {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.terms-content {
  max-width: 800px;
  margin: 0 auto;
  padding-top: 48px;
}
.terms-content h1 {
  font-size: 32px;
  font-weight: 800;
  color: #ffffff;
  margin: 0 0 8px;
  line-height: 1.2;
}
.terms-content .subtitle {
  font-size: 14px;
  color: rgba(255,255,255,0.4);
  margin: 0 0 40px;
}
.terms-content h2 {
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  margin: 40px 0 16px;
  padding-top: 24px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
.terms-content h2:first-of-type {
  border-top: none;
  padding-top: 0;
}
.terms-content h3 {
  font-size: 16px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
  margin: 32px 0 12px;
}
.terms-content p {
  font-size: 15px;
  line-height: 1.8;
  margin: 0 0 16px;
  color: #94a3b8;
}
.terms-content ul {
  margin: 0 0 16px;
  padding-left: 0;
  list-style: none;
}
.terms-content li {
  font-size: 15px;
  line-height: 1.8;
  color: #94a3b8;
  padding: 4px 0 4px 24px;
  position: relative;
}
.terms-content li::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 14px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c59b4a;
}
.terms-content a {
  color: #c59b4a;
  text-decoration: underline;
}
.terms-divider {
  border: none;
  border-top: 2px solid rgba(255,255,255,0.08);
  margin: 48px 0;
}
`;

export default function TermsOfService() {
  const { navigate } = useContext(AppContext);

  return (
    <>
      <style>{css}</style>
      <div className="terms-bg">
        <div className="terms-header">
          <div className="terms-header-inner">
            <button onClick={() => navigate('landing')} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '18px', fontWeight: '800', color: '#c59b4a',
              letterSpacing: '-0.02em'
            }}>
              Regalos Que Cantan
            </button>
          </div>
        </div>

        <div className="terms-content">
          <h1>Terms of Service</h1>
          <p className="subtitle">Last updated: April 13, 2026</p>

          {/* ── ENGLISH ── */}
          <h2>1. Program Overview</h2>
          <p>
            <strong>Regalos Que Cantan</strong> is a personalized song creation service
            operated by <strong>Regalos Media LLC</strong>. By using our service, you
            agree to these Terms of Service.
          </p>

          <h2>2. SMS / Text Message Terms</h2>
          <p>
            When you provide your phone number during checkout, you consent to receive
            transactional text messages from Regalos Que Cantan. By opting in, you agree
            to the following:
          </p>
          <ul>
            <li><strong>Program name:</strong> Regalos Que Cantan</li>
            <li><strong>Message frequency:</strong> Message frequency varies. You will receive messages related to your order status, delivery notifications, and support responses</li>
            <li><strong>Message and data rates may apply.</strong> Contact your carrier for details about your text messaging plan</li>
            <li><strong>To unsubscribe:</strong> Reply <strong>STOP</strong> to any message to opt out at any time</li>
            <li><strong>For help:</strong> Reply <strong>HELP</strong> to any message, or email <a href="mailto:soporte@regalosquecantan.com">soporte@regalosquecantan.com</a></li>
          </ul>
          <p>
            Opting out of SMS will not affect your order. You will still receive your
            song via email.
          </p>

          <h2>3. Service Description</h2>
          <p>
            Regalos Que Cantan creates AI-generated personalized songs based on the
            information you provide during the order process. Songs are delivered
            digitally via email and/or WhatsApp.
          </p>

          <h2>4. Payment</h2>
          <p>
            All payments are processed securely through Stripe. Prices are displayed
            in USD and are final at the time of checkout. You will receive a digital
            product (personalized song) and delivery is considered complete upon
            email/WhatsApp delivery.
          </p>

          <h2>5. Intellectual Property</h2>
          <p>
            Upon purchase, you receive a personal-use license for your custom song.
            You may share, play, and gift the song freely. Commercial use, resale,
            or redistribution for profit is not permitted without written consent
            from Regalos Media LLC.
          </p>

          <h2>6. Privacy</h2>
          <p>
            Your use of our service is also governed by our{' '}
            <a href="/politica-de-privacidad" target="_blank" rel="noopener noreferrer">Privacy Policy</a>,
            which describes how we collect, use, and protect your personal information.
          </p>

          <h2>7. Contact</h2>
          <p>
            For questions about these Terms of Service, contact us at:
          </p>
          <p>
            <strong>Email:</strong> <a href="mailto:soporte@regalosquecantan.com">soporte@regalosquecantan.com</a><br/>
            <strong>Business:</strong> Regalos Media LLC
          </p>

          <hr className="terms-divider" />

          {/* ── SPANISH ── */}
          <h1>Términos de Servicio</h1>
          <p className="subtitle">Última actualización: 13 de abril de 2026</p>

          <h2>1. Descripción del Programa</h2>
          <p>
            <strong>Regalos Que Cantan</strong> es un servicio de creación de canciones
            personalizadas operado por <strong>Regalos Media LLC</strong>. Al usar nuestro
            servicio, aceptas estos Términos de Servicio.
          </p>

          <h2>2. Términos de SMS / Mensajes de Texto</h2>
          <p>
            Cuando proporcionas tu número de teléfono durante el proceso de pago, aceptas
            recibir mensajes de texto transaccionales de Regalos Que Cantan. Al optar por
            recibirlos, aceptas lo siguiente:
          </p>
          <ul>
            <li><strong>Nombre del programa:</strong> Regalos Que Cantan</li>
            <li><strong>Frecuencia de mensajes:</strong> La frecuencia de mensajes varía. Recibirás mensajes relacionados con el estado de tu pedido, notificaciones de entrega y respuestas de soporte</li>
            <li><strong>Pueden aplicar tarifas de mensajes y datos.</strong> Contacta a tu operador para obtener detalles sobre tu plan de mensajes de texto</li>
            <li><strong>Para cancelar:</strong> Responde <strong>STOP</strong> a cualquier mensaje para darte de baja en cualquier momento</li>
            <li><strong>Para ayuda:</strong> Responde <strong>HELP</strong> a cualquier mensaje, o escribe a <a href="mailto:soporte@regalosquecantan.com">soporte@regalosquecantan.com</a></li>
          </ul>
          <p>
            Cancelar los SMS no afectará tu pedido. Seguirás recibiendo tu canción
            por correo electrónico.
          </p>

          <h2>3. Descripción del Servicio</h2>
          <p>
            Regalos Que Cantan crea canciones personalizadas generadas por IA basadas en
            la información que proporcionas durante el proceso de pedido. Las canciones se
            entregan digitalmente por correo electrónico y/o WhatsApp.
          </p>

          <h2>4. Pago</h2>
          <p>
            Todos los pagos se procesan de forma segura a través de Stripe. Los precios se
            muestran en USD y son finales al momento del pago. Recibirás un producto digital
            (canción personalizada) y la entrega se considera completada al momento de la
            entrega por correo electrónico/WhatsApp.
          </p>

          <h2>5. Propiedad Intelectual</h2>
          <p>
            Al realizar la compra, recibes una licencia de uso personal para tu canción
            personalizada. Puedes compartir, reproducir y regalar la canción libremente.
            El uso comercial, reventa o redistribución con fines de lucro no está permitido
            sin el consentimiento escrito de Regalos Media LLC.
          </p>

          <h2>6. Privacidad</h2>
          <p>
            Tu uso de nuestro servicio también se rige por nuestra{' '}
            <a href="/politica-de-privacidad" target="_blank" rel="noopener noreferrer">Política de Privacidad</a>,
            que describe cómo recopilamos, usamos y protegemos tu información personal.
          </p>

          <h2>7. Contacto</h2>
          <p>
            Para preguntas sobre estos Términos de Servicio, contáctanos en:
          </p>
          <p>
            <strong>Correo:</strong> <a href="mailto:soporte@regalosquecantan.com">soporte@regalosquecantan.com</a><br/>
            <strong>Empresa:</strong> Regalos Media LLC
          </p>
        </div>
      </div>
    </>
  );
}
