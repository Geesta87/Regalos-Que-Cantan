import React, { useContext } from 'react';
import { AppContext } from '../App';

const css = `
.aff-terms-bg {
  min-height: 100vh;
  background: #f0f5ff;
  font-family: 'Inter', 'Nunito', -apple-system, BlinkMacSystemFont, sans-serif;
  color: #475569;
  padding: 0 20px 80px;
}
.aff-terms-header {
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  padding: 14px 28px;
  position: sticky;
  top: 0;
  z-index: 10;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.aff-terms-header-inner {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.aff-terms-content {
  max-width: 800px;
  margin: 0 auto;
  padding-top: 48px;
}
.aff-terms-content h1 {
  font-size: 36px;
  font-weight: 800;
  color: #1e3a5f;
  margin: 0 0 8px;
  line-height: 1.2;
}
.aff-terms-content h2 {
  font-size: 20px;
  font-weight: 700;
  color: #1e3a5f;
  margin: 40px 0 16px;
  padding-top: 24px;
  border-top: 1px solid #e2e8f0;
}
.aff-terms-content h2:first-of-type {
  border-top: none;
  padding-top: 0;
}
.aff-terms-content p {
  font-size: 15px;
  line-height: 1.8;
  margin: 0 0 16px;
  color: #64748b;
}
.aff-terms-content ul {
  margin: 0 0 16px;
  padding-left: 0;
  list-style: none;
}
.aff-terms-content li {
  font-size: 15px;
  line-height: 1.8;
  color: #64748b;
  padding: 6px 0 6px 28px;
  position: relative;
}
.aff-terms-content li::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 16px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
}
.aff-terms-content strong {
  color: #1e3a5f;
}
.aff-terms-highlight {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 16px;
  padding: 24px 28px;
  margin: 24px 0;
}
.aff-terms-highlight p {
  color: #475569;
  margin: 0;
}
.aff-terms-back {
  padding: 8px 18px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #64748b;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  text-decoration: none;
}
.aff-terms-back:hover { border-color: #93c5fd; color: #2563eb; }
`;

export default function AffiliateTerms() {
  const { navigateTo } = useContext(AppContext);

  return (
    <>
      <style>{css}</style>
      <div className="aff-terms-bg">
        <header className="aff-terms-header">
          <div className="aff-terms-header-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎵</div>
              <div>
                <h1 style={{ fontSize: 16, fontWeight: 700, color: '#1e3a5f', margin: 0 }}>RegalosQueCantan</h1>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>Partner Portal</span>
              </div>
            </div>
            <button onClick={() => navigateTo('affiliateLogin')} className="aff-terms-back">← Volver</button>
          </div>
        </header>

        <div className="aff-terms-content">
          <p style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>Programa de Afiliados</p>
          <h1>Terminos y Condiciones</h1>
          <p style={{ color: '#94a3b8', fontSize: 13 }}>Ultima actualizacion: Abril 2026</p>

          <div className="aff-terms-highlight">
            <p>
              Este acuerdo es entre <strong>tu ("el Afiliado")</strong> y <strong>RegalosQueCantan ("la Empresa")</strong>. Al participar en nuestro programa de afiliados, aceptas los siguientes terminos. Los escribimos en lenguaje simple para que sean faciles de entender.
            </p>
          </div>

          <h2>1. ¿En que consiste el programa?</h2>
          <p>
            Como afiliado de RegalosQueCantan, recibiras un <strong>link unico</strong> y un <strong>codigo de descuento personal</strong>. Cuando alguien compre una cancion personalizada a traves de tu link o usando tu codigo, tu ganas una comision por esa venta.
          </p>
          <p>
            Tu rol es compartir tu link y codigo con tu audiencia. Nosotros nos encargamos de todo lo demas: crear la cancion, cobrar al cliente, y entregar el producto.
          </p>

          <h2>2. Comisiones</h2>
          <ul>
            <li>Tu comision es del <strong>20% por cada venta completada</strong> que se genere a traves de tu link o codigo de descuento.</li>
            <li>La comision se calcula sobre el <strong>monto total pagado por el cliente</strong>, sin importar el tamano de la orden.</li>
            <li>Las comisiones solo aplican a <strong>ventas completadas y pagadas</strong>. Si un cliente solicita un reembolso, la comision de esa venta se revierte.</li>
            <li>Puedes ver tus comisiones en tiempo real desde tu <strong>dashboard de afiliado</strong>.</li>
          </ul>

          <h2>3. Pagos</h2>
          <ul>
            <li>Los pagos se realizan de forma <strong>mensual</strong>, dentro de los primeros 15 dias del mes siguiente.</li>
            <li>El monto minimo para recibir un pago es de <strong>$20 USD</strong>. Si tu balance es menor, se acumula para el siguiente mes.</li>
            <li>Los pagos se envian via <strong>Zelle, Venmo, PayPal, o transferencia bancaria</strong>, segun tu preferencia.</li>
            <li>Es tu responsabilidad proporcionarnos la informacion correcta para recibir tus pagos.</li>
          </ul>

          <h2>4. Atribucion de ventas</h2>
          <ul>
            <li>Una venta se atribuye a ti cuando el cliente <strong>llega a traves de tu link</strong> (?ref=tucodigo) o <strong>usa tu codigo de descuento</strong> al momento de pagar.</li>
            <li>La atribucion es por <strong>sesion</strong> — es decir, el cliente debe completar la compra en la misma visita en que hizo clic en tu link.</li>
            <li>Si un cliente llega por tu link pero paga usando el codigo de otro afiliado, <strong>el codigo de descuento tiene prioridad</strong>.</li>
          </ul>

          <h2>5. Lo que puedes hacer</h2>
          <ul>
            <li>Compartir tu link y codigo en tus <strong>redes sociales, videos, stories, podcasts, blogs</strong>, y cualquier canal donde tengas audiencia.</li>
            <li>Hablar de tu experiencia con RegalosQueCantan de forma <strong>autentica y honesta</strong>.</li>
            <li>Usar los materiales promocionales que te proporcionemos (si aplica).</li>
            <li>Contactarnos en cualquier momento con preguntas o ideas.</li>
          </ul>

          <h2>6. Lo que NO puedes hacer</h2>
          <ul>
            <li><strong>Spam:</strong> No envies mensajes masivos no solicitados, comentarios spam, o correos a personas que no te conocen.</li>
            <li><strong>Trafico falso:</strong> No uses bots, granjas de clics, o cualquier metodo artificial para generar visitas o ventas.</li>
            <li><strong>Publicidad enganosa:</strong> No hagas promesas falsas sobre el producto, precios, o resultados. Siempre se honesto.</li>
            <li><strong>Anuncios de marca:</strong> No compres anuncios pagados (Google Ads, Meta Ads, etc.) usando el nombre "RegalosQueCantan" o variaciones como palabra clave, sin autorizacion previa.</li>
            <li><strong>Contenido ofensivo:</strong> No asocies nuestra marca con contenido violento, discriminatorio, o ilegal.</li>
          </ul>

          <h2>7. Transparencia y datos</h2>
          <p>
            Creemos en la <strong>transparencia total</strong>. Desde tu dashboard puedes ver en tiempo real:
          </p>
          <ul>
            <li>Cuantos visitantes llegaron por tu link</li>
            <li>Cuantos iniciaron una compra</li>
            <li>Cuantas ventas se completaron</li>
            <li>Cuanto has ganado en comisiones</li>
          </ul>
          <p>
            <strong>Privacidad:</strong> No compartimos informacion personal de los clientes contigo (nombres, emails, etc.). Solo ves datos agregados de tus ventas.
          </p>

          <h2>8. Cambios al programa</h2>
          <ul>
            <li>Nos reservamos el derecho de modificar la tasa de comision, las reglas del programa, o estos terminos.</li>
            <li>Cualquier cambio a la tasa de comision se te notificara con <strong>al menos 30 dias de anticipacion</strong>.</li>
            <li>Si no estas de acuerdo con los cambios, puedes terminar tu participacion en cualquier momento.</li>
          </ul>

          <h2>9. Terminacion</h2>
          <ul>
            <li><strong>Tu puedes salir cuando quieras.</strong> Solo contactanos y desactivaremos tu cuenta.</li>
            <li>Nosotros tambien podemos terminar tu participacion si violas estos terminos o si detectamos actividad fraudulenta.</li>
            <li>Si la relacion termina, <strong>las comisiones pendientes que ya hayas ganado se te pagaran</strong> en el siguiente ciclo de pago, siempre y cuando no haya habido fraude.</li>
          </ul>

          <h2>10. Relacion entre las partes</h2>
          <p>
            Como afiliado, eres un <strong>colaborador independiente</strong>, no un empleado, socio, ni representante legal de RegalosQueCantan. Este acuerdo no crea una relacion laboral, sociedad, ni agencia entre las partes.
          </p>
          <p>
            Eres responsable de cumplir con las leyes y regulaciones aplicables en tu localidad relacionadas con tus actividades como afiliado.
          </p>

          <h2>11. Contacto</h2>
          <p>
            ¿Tienes preguntas sobre estos terminos o el programa? Escribenos a <a href="mailto:hola@regalosquecantan.com" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>hola@regalosquecantan.com</a> — estamos para ayudarte.
          </p>

          <div style={{ background: '#ecfdf5', borderRadius: 16, padding: '28px 32px', border: '1px solid #a7f3d0', margin: '40px 0 0', textAlign: 'center' }}>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#10b981', margin: '0 0 8px' }}>¿Listo para empezar?</p>
            <p style={{ color: '#64748b', margin: '0 0 20px', fontSize: 14 }}>Al crear tu cuenta de afiliado, confirmas que has leido y aceptas estos terminos.</p>
            <button
              onClick={() => navigateTo('affiliateLogin')}
              style={{ padding: '14px 36px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}
            >
              Ir al portal de afiliados
            </button>
          </div>

          <p style={{ textAlign: 'center', color: '#cbd5e1', fontSize: 12, marginTop: 40 }}>
            © 2026 RegalosQueCantan. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </>
  );
}
