import React, { useContext } from 'react';
import { AppContext } from '../App';

const css = `
.policy-bg {
  min-height: 100vh;
  background: #0a0a0f;
  font-family: 'Inter', 'Nunito', -apple-system, BlinkMacSystemFont, sans-serif;
  color: #cbd5e1;
  padding: 0 20px 80px;
}
.policy-header {
  background: rgba(10,10,15,0.95);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 14px 28px;
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(12px);
}
.policy-header-inner {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.policy-content {
  max-width: 800px;
  margin: 0 auto;
  padding-top: 48px;
}
.policy-content h1 {
  font-size: 32px;
  font-weight: 800;
  color: #ffffff;
  margin: 0 0 8px;
  line-height: 1.2;
}
.policy-content .subtitle {
  font-size: 14px;
  color: rgba(255,255,255,0.4);
  margin: 0 0 40px;
}
.policy-content h2 {
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  margin: 40px 0 16px;
  padding-top: 24px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
.policy-content h2:first-of-type {
  border-top: none;
  padding-top: 0;
}
.policy-content h3 {
  font-size: 16px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
  margin: 32px 0 12px;
}
.policy-content p {
  font-size: 15px;
  line-height: 1.8;
  margin: 0 0 16px;
  color: #94a3b8;
}
.policy-content ul {
  margin: 0 0 16px;
  padding-left: 0;
  list-style: none;
}
.policy-content li {
  font-size: 15px;
  line-height: 1.8;
  color: #94a3b8;
  padding: 4px 0 4px 24px;
  position: relative;
}
.policy-content li::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 14px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c59b4a;
}
.policy-content a {
  color: #c59b4a;
  text-decoration: underline;
}
.policy-divider {
  border: none;
  border-top: 2px solid rgba(255,255,255,0.08);
  margin: 48px 0;
}
`;

export default function PrivacyPolicy() {
  const { navigate } = useContext(AppContext);

  return (
    <>
      <style>{css}</style>
      <div className="policy-bg">
        <div className="policy-header">
          <div className="policy-header-inner">
            <button onClick={() => navigate('landing')} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '18px', fontWeight: '800', color: '#c59b4a',
              letterSpacing: '-0.02em'
            }}>
              Regalos Que Cantan
            </button>
          </div>
        </div>

        <div className="policy-content">
          <h1>Privacy Policy</h1>
          <p className="subtitle">Last updated: April 13, 2026</p>

          {/* ── ENGLISH ── */}
          <h2>1. Who We Are</h2>
          <p>
            Regalos Que Cantan is a service operated by <strong>Regalos Media LLC</strong>.
            This Privacy Policy explains how we collect, use, and protect your personal
            information when you use our website and services at regalosquecantan.com.
          </p>

          <h2>2. Information We Collect</h2>
          <p>We collect the following information when you place an order:</p>
          <ul>
            <li>Name (yours and the recipient's)</li>
            <li>Email address</li>
            <li>Phone number</li>
            <li>Order details (song preferences, occasion, personal message)</li>
          </ul>

          <h2>3. How We Use Your Information</h2>
          <p>Your information is used solely for:</p>
          <ul>
            <li>Processing and fulfilling your order</li>
            <li>Sending transactional SMS messages related to your order (delivery notifications, order updates)</li>
            <li>Delivering your personalized song via email or WhatsApp</li>
            <li>Customer support related to your order</li>
          </ul>

          <h2>4. We Do Not Sell Your Data</h2>
          <p>
            We do not sell, trade, or rent your personal information to third parties.
            Your data is never shared for marketing purposes. We only share information
            with payment processors and delivery services strictly necessary to fulfill
            your order.
          </p>

          <h2>5. SMS / Text Messages</h2>
          <p>
            By providing your phone number at checkout, you consent to receive transactional
            text messages from Regalos Que Cantan about your order. These messages are
            limited to order confirmations, delivery notifications, and support responses.
          </p>
          <ul>
            <li>Message frequency varies based on your order status</li>
            <li>Message and data rates may apply</li>
            <li><strong>Reply STOP to any message to opt out at any time</strong></li>
            <li>Reply HELP for assistance</li>
          </ul>
          <p>
            <strong>No mobile information will be shared with third parties or affiliates
            for marketing or promotional purposes.</strong> Information sharing to
            subcontractors in support services, such as customer service, is permitted.
            All other categories exclude text messaging originator opt-in data and
            consent; this information will not be shared with any third parties.
          </p>

          <h2>6. Data Security</h2>
          <p>
            We use industry-standard security measures to protect your personal information.
            Payment processing is handled by Stripe, a PCI-compliant payment processor.
            We do not store your credit card information on our servers.
          </p>

          <h2>7. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy or want to request deletion
            of your data, contact us at:
          </p>
          <p>
            <strong>Email:</strong> <a href="mailto:soporte@regalosquecantan.com">soporte@regalosquecantan.com</a><br/>
            <strong>Business:</strong> Regalos Media LLC
          </p>

          <hr className="policy-divider" />

          {/* ── SPANISH ── */}
          <h1>Política de Privacidad</h1>
          <p className="subtitle">Última actualización: 13 de abril de 2026</p>

          <h2>1. Quiénes Somos</h2>
          <p>
            Regalos Que Cantan es un servicio operado por <strong>Regalos Media LLC</strong>.
            Esta Política de Privacidad explica cómo recopilamos, usamos y protegemos tu
            información personal cuando utilizas nuestro sitio web y servicios en regalosquecantan.com.
          </p>

          <h2>2. Información Que Recopilamos</h2>
          <p>Recopilamos la siguiente información cuando realizas un pedido:</p>
          <ul>
            <li>Nombre (tuyo y del destinatario)</li>
            <li>Correo electrónico</li>
            <li>Número de teléfono</li>
            <li>Detalles del pedido (preferencias de canción, ocasión, mensaje personal)</li>
          </ul>

          <h2>3. Cómo Usamos Tu Información</h2>
          <p>Tu información se utiliza únicamente para:</p>
          <ul>
            <li>Procesar y cumplir tu pedido</li>
            <li>Enviar mensajes SMS transaccionales relacionados con tu pedido (notificaciones de entrega, actualizaciones del pedido)</li>
            <li>Entregar tu canción personalizada por correo electrónico o WhatsApp</li>
            <li>Soporte al cliente relacionado con tu pedido</li>
          </ul>

          <h2>4. No Vendemos Tus Datos</h2>
          <p>
            No vendemos, intercambiamos ni alquilamos tu información personal a terceros.
            Tus datos nunca se comparten con fines de marketing. Solo compartimos información
            con procesadores de pago y servicios de entrega estrictamente necesarios para
            cumplir tu pedido.
          </p>

          <h2>5. SMS / Mensajes de Texto</h2>
          <p>
            Al proporcionar tu número de teléfono al momento del pago, aceptas recibir
            mensajes de texto transaccionales de Regalos Que Cantan sobre tu pedido.
            Estos mensajes se limitan a confirmaciones de pedido, notificaciones de
            entrega y respuestas de soporte.
          </p>
          <ul>
            <li>La frecuencia de los mensajes varía según el estado de tu pedido</li>
            <li>Pueden aplicar tarifas de mensajes y datos</li>
            <li><strong>Responde STOP a cualquier mensaje para cancelar en cualquier momento</strong></li>
            <li>Responde HELP para obtener ayuda</li>
          </ul>
          <p>
            <strong>Ninguna información móvil será compartida con terceros o afiliados
            con fines de marketing o promocionales.</strong> Se permite compartir
            información con subcontratistas de servicios de soporte, como atención al
            cliente. Todas las demás categorías excluyen los datos de consentimiento
            y suscripción de mensajes de texto; esta información no será compartida
            con ningún tercero.
          </p>

          <h2>6. Seguridad de Datos</h2>
          <p>
            Utilizamos medidas de seguridad estándar de la industria para proteger tu
            información personal. El procesamiento de pagos es manejado por Stripe,
            un procesador de pagos compatible con PCI. No almacenamos la información
            de tu tarjeta de crédito en nuestros servidores.
          </p>

          <h2>7. Contáctanos</h2>
          <p>
            Si tienes preguntas sobre esta Política de Privacidad o deseas solicitar
            la eliminación de tus datos, contáctanos en:
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
