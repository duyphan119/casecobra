import { db } from "@/db";
import { stripe } from "@/lib/stripe";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { Resend } from "resend";
import OrderReceivedEmail from "@/components/emails/OrderReceivedEmail";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const signature = headers().get("stripe-signature");

    if (!signature) {
      return new Response("Invalid signature", { status: 400 });
    }

    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === "checkout.session.completed") {
      if (!event.data.object.customer_details?.email) {
        throw new Error("Missing user email");
      }

      const session = event.data.object as Stripe.Checkout.Session;

      const { userId, orderId } = session.metadata || {
        userId: null,
        orderId: null,
      };

      if (!orderId || !userId) {
        throw new Error("Invalid request metadata");
      }
      console.log(session, session.customer_details, session.shipping_details);

      const billingAddress = session.customer_details!.address;
      // log ra thì .shipping còn Stripe.Checkout.Session nhắc lệnh là .shipping_details nên phải ép sang kiểu any
      const shippingAddress = (session as any).shipping
        .address as Stripe.Address | null;

      await db.order.update({
        where: {
          id: orderId,
        },
        data: {
          isPaid: true,
          shippingAddress: {
            create: {
              name: session.customer_details!.name!,
              city: shippingAddress!.city!,
              country: shippingAddress!.country!,
              postalCode: shippingAddress!.postal_code!,
              state: shippingAddress!.state,
              street: shippingAddress!.line1!,
            },
          },
          billingAddress: {
            create: {
              name: session.customer_details!.name!,
              city: billingAddress!.city!,
              country: billingAddress!.country!,
              postalCode: billingAddress!.postal_code!,
              state: billingAddress!.state,
              street: billingAddress!.line1!,
            },
          },
        },
      });

      await resend.emails.send({
        from: `CaseCobra <${process.env.ADMIN_EMAIL}>`,
        to: [event.data.object.customer_details.email],
        subject: "Thanks for your order",
        react: OrderReceivedEmail({
          orderId,
          orderDate: new Date().toLocaleDateString(),
          //@ts-ignore
          shippingAddress: {
            name: session.customer_details!.name!,
            city: shippingAddress!.city!,
            country: shippingAddress!.country!,
            postalCode: shippingAddress!.postal_code!,
            state: shippingAddress!.state,
            street: shippingAddress!.line1!,
          },
        }),
      });
    }

    return NextResponse.json({
      result: event,
      ok: true,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        message: "Something went wrong",
      },
      { status: 500 }
    );
  }
}
